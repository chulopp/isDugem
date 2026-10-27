"""Unit dan integration test audit regresi geofence, decision engine, dan MQTT server.

Memverifikasi 10 kasus wajib sesuai PRD dan instruksi audit:
1. Anak berada di luar radius bar: status sesuai aturan normal yang berlaku.
2. Anak berada tepat di dalam radius bar: status sesuai aturan risiko bar.
3. Anak berada pada jarak 183 meter (RedHare) dari titik bar dengan radius 250 meter: geofence bar terdeteksi.
4. Anak berada tepat pada batas radius 250 meter: perilaku operator batas (<= 250.0m).
5. Anak keluar dari radius bar: status diperbarui kembali ke normal.
6. Anak berada di dalam radius asrama/kos 750 meter.
7. Anak berada di dalam radius masjid 100 meter.
8. Pembaruan reason/jarak saat berpindah posisi di status yang sama (tidak macet di jarak lama).
9. Payload MQTT tidak lengkap atau tidak valid ditangani secara aman (graceful error handling).
10. Sequence reset / restart client ditangani dengan benar.
"""
import json
from datetime import datetime
from zoneinfo import ZoneInfo
import pytest

from config import load_config
from main import GuardianServer
from models import Status
from processing.decision_engine import Context, classify, JAM_MALAM, WAKTU_SHOLAT, JAM_KULIAH, LAINNYA
from processing.haversine import haversine_distance_m

WIB = ZoneInfo("Asia/Jakarta")


def epoch_ms(hh, mm):
    return int(datetime(2026, 10, 26, hh, mm, tzinfo=WIB).timestamp() * 1000)


def anak_payload(lat, lon, rms=None, hh=23, mm=0, seq=1, db=None):
    audio = {}
    if rms is not None:
        audio["rms"] = rms
    if db is not None:
        audio["db"] = db
    if not audio:
        audio["db"] = 40.0
    return {
        "device_id": "anak",
        "sequence": seq,
        "sent_at_ms": epoch_ms(hh, mm) + seq,
        "location": {"lat": lat, "lon": lon, "accuracy_m": 8.5},
        "audio": audio,
        "motion": {"accel_magnitude": 9.9},
    }


@pytest.fixture
def env(monkeypatch, tmp_path):
    for key in (
        "PROJECT_ID", "TIMEZONE", "USE_SERVER_CLOCK", "ALERT_HEARTBEAT_S",
        "PING_REPUBLISH", "KULIAH_WINDOW", "SHOLAT_WINDOWS", "MALAM_WINDOW",
        "POI_KAMPUS", "POI_MASJID", "POI_KOS", "POI_BAR",
    ):
        monkeypatch.delenv(key, raising=False)
    return tmp_path / "kosong.env"


@pytest.fixture
def server_fixture(env):
    cfg = load_config(env)
    published = []

    def mock_publish(topic, payload, retain=False):
        published.append((topic, payload, retain))
        return None

    srv = GuardianServer(cfg, publish=mock_publish, clock=lambda: 1_790_000_000.0)
    return srv, published, cfg


def make_ctx(time_label, kampus=3000.0, masjid=3000.0, kos=3000.0, bar=3000.0, db=40.0, claimed_at_kos=False):
    return Context(
        time_label=time_label,
        distance_kampus_m=kampus,
        distance_masjid_m=masjid,
        distance_kos_m=kos,
        distance_bar_m=bar,
        db_level=db,
        claimed_at_kos=claimed_at_kos,
    )


# 1. Anak berada di luar radius bar: status normal
def test_anak_di_luar_radius_bar_jam_malam_normal():
    # Jauh dari bar (> 250m), jauh dari kos (> 750m), suara tenang
    ctx = make_ctx(
        time_label=JAM_MALAM,
        kos=1200.0,
        bar=251.0,
        db=42.0,
        claimed_at_kos=False,
    )
    assert classify(ctx) == Status.NORMAL


# 2. Anak berada tepat di dalam radius bar: status risiko bar
def test_anak_di_dalam_radius_bar_jam_malam_critical():
    # Di dalam radius bar (<= 250m), suara bising > 75 dB pada jam malam
    ctx_bar = make_ctx(
        time_label=JAM_MALAM,
        kos=1200.0,
        bar=50.0,
        db=82.0,
        claimed_at_kos=False,
    )
    assert classify(ctx_bar) == Status.CRITICAL_TERDETEKSI_DI_BAR


# 3. Anak pada jarak 183 meter (RedHare) dari titik bar dengan radius 250 meter
def test_anak_di_redhare_183m_terdeteksi_geofence_bar(server_fixture):
    srv, published, cfg = server_fixture
    # RedHare Kota Lama: -6.968000, 110.428500
    # Golden Tiger Bar: -6.966984, 110.429807
    dist_redhare_bar = haversine_distance_m(-6.968000, 110.428500, cfg.poi["bar"].lat, cfg.poi["bar"].lon)
    assert 180.0 <= dist_redhare_bar <= 186.0  # ~183.2m, masuk radius bar 250m!

    # Sesuai PRD: Jika suara bising (> 75 dB) pada jam malam di RedHare -> CRITICAL
    ctx_loud = make_ctx(
        time_label=JAM_MALAM,
        kos=1200.0,
        bar=dist_redhare_bar,
        db=81.0,
        claimed_at_kos=False,
    )
    assert classify(ctx_loud) == Status.CRITICAL_TERDETEKSI_DI_BAR

    # Sesuai PRD: Jika suara tenang (42.2 dB seperti di screenshot) -> NORMAL (bukan critical)
    ctx_quiet = make_ctx(
        time_label=JAM_MALAM,
        kos=1200.0,
        bar=dist_redhare_bar,
        db=42.2,
        claimed_at_kos=False,
    )
    assert classify(ctx_quiet) == Status.NORMAL


# 4. Anak berada tepat pada batas radius 250 meter
def test_batas_radius_bar_250m_operator():
    # Tepat 250.0m adalah di dalam radius (<= 250.0)
    ctx_exact = make_ctx(
        time_label=JAM_MALAM,
        kos=1200.0,
        bar=250.0,
        db=78.0,
        claimed_at_kos=False,
    )
    assert classify(ctx_exact) == Status.CRITICAL_TERDETEKSI_DI_BAR

    # 250.1m sudah di luar radius (> 250.0) -> NORMAL
    ctx_outside = make_ctx(
        time_label=JAM_MALAM,
        kos=1200.0,
        bar=250.1,
        db=78.0,
        claimed_at_kos=False,
    )
    assert classify(ctx_outside) == Status.NORMAL


# 5. Anak keluar dari radius bar: status diperbarui kembali ke normal
def test_anak_keluar_dari_radius_bar_status_pulih(server_fixture):
    srv, published, cfg = server_fixture
    # Telemetry 1: Anak di bar jam 23:00, suara 85 dB
    payload_1 = anak_payload(cfg.poi["bar"].lat, cfg.poi["bar"].lon, hh=23, mm=0, seq=1, db=85.0)
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(payload_1).encode())

    assert len(published) == 1
    assert published[0][1]["status"] == "CRITICAL_TERDETEKSI_DI_BAR"
    assert published[0][2] is True  # retain=True

    # Telemetry 2: Anak bergerak keluar dari bar (> 500m) pada jam 23:05, suara 45 dB
    payload_2 = anak_payload(-6.980000, 110.429807, hh=23, mm=5, seq=2, db=45.0)
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(payload_2).encode())

    assert len(published) == 2
    assert published[1][1]["status"] == "NORMAL"
    assert published[1][2] is True


# 6. Anak berada di dalam radius asrama/kos 750 meter
def test_anak_di_dalam_radius_kos_750m():
    # Radius kos 750m. Jika di 700m pada jam malam dan tenang -> ISTIRAHAT_DI_KOS
    ctx_kos = make_ctx(
        time_label=JAM_MALAM,
        kos=700.0,
        db=40.0,
        claimed_at_kos=True,
    )
    assert classify(ctx_kos) == Status.ISTIRAHAT_DI_KOS

    # Jika > 750m (misal 750.1m) -> NORMAL
    ctx_luar_kos = make_ctx(
        time_label=JAM_MALAM,
        kos=750.1,
        db=40.0,
        claimed_at_kos=False,
    )
    assert classify(ctx_luar_kos) == Status.NORMAL


# 7. Anak berada di dalam radius masjid 100 meter
def test_anak_di_dalam_radius_masjid_100m():
    # Waktu sholat: masjid <= 100m -> NORMAL (sudah di masjid)
    ctx_masjid_in = make_ctx(
        time_label=WAKTU_SHOLAT,
        masjid=95.0,
        db=40.0,
        claimed_at_kos=False,
    )
    assert classify(ctx_masjid_in) == Status.NORMAL

    # Waktu sholat: masjid > 100m -> WARNING_BELUM_KE_MASJID
    ctx_masjid_out = make_ctx(
        time_label=WAKTU_SHOLAT,
        masjid=105.0,
        db=40.0,
        claimed_at_kos=False,
    )
    assert classify(ctx_masjid_out) == Status.WARNING_BELUM_KE_MASJID


# 8. Pembaruan reason/jarak saat berpindah posisi di status yang sama
def test_pembaruan_reason_jarak_ketika_bergerak_di_status_yang_sama(server_fixture):
    srv, published, cfg = server_fixture

    # Posisi 1: jam sholat 12:10, jarak ke masjid ~300m
    lat_1 = cfg.poi["masjid"].lat + 0.0027  # ~300m
    payload_1 = anak_payload(lat_1, cfg.poi["masjid"].lon, hh=12, mm=10, seq=1, db=40.0)
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(payload_1).encode())

    assert len(published) == 1
    assert published[0][1]["status"] == "WARNING_BELUM_KE_MASJID"
    reason_1 = published[0][1]["reason"]
    assert "masjid" in reason_1

    # Posisi 2: bergerak mendekat ke arah masjid (~200m, selisih > 15m)
    lat_2 = cfg.poi["masjid"].lat + 0.0018  # ~200m
    payload_2 = anak_payload(lat_2, cfg.poi["masjid"].lon, hh=12, mm=11, seq=2, db=40.0)
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(payload_2).encode())

    # Alert kedua harus dipublikasikan dengan update jarak baru, tidak macet di 300m
    assert len(published) == 2
    assert published[1][1]["status"] == "WARNING_BELUM_KE_MASJID"
    reason_2 = published[1][1]["reason"]
    assert reason_2 != reason_1


# 9. Payload MQTT tidak lengkap atau tidak valid ditangani secara aman
def test_payload_mqtt_tidak_valid_ditangani_dengan_aman(server_fixture):
    srv, published, cfg = server_fixture

    # Payload rusak (JSON tidak valid)
    srv.handle_message(cfg.topic_anak_telemetry, b"invalid json content")
    assert len(published) == 0

    # Payload hilang field penting
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps({"device_id": "anak"}).encode())
    assert len(published) == 0

    # Server tetap sehat dan dapat memproses pesan valid berikutnya
    payload_valid = anak_payload(cfg.poi["kampus"].lat, cfg.poi["kampus"].lon, hh=9, mm=0, seq=1, db=50.0)
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(payload_valid).encode())
    assert len(published) == 1
    assert published[0][1]["status"] == "SEDANG_KULIAH"


# 10. Audit fokus logika sequence reset & rejection paket usang
def test_sequence_turun_sedikit_timestamp_lama_ditolak(server_fixture):
    srv, published, cfg = server_fixture
    # Paket seq 20 pada t=20s
    t0 = epoch_ms(9, 0)
    p1 = anak_payload(cfg.poi["kampus"].lat, cfg.poi["kampus"].lon, hh=9, mm=0, seq=20, db=50.0)
    p1["sent_at_ms"] = t0 + 20_000
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(p1).encode())
    assert srv.latest_anak.sequence == 20
    assert len(published) == 1

    # Paket out-of-order seq 19 dengan timestamp lebih lama
    p2 = anak_payload(cfg.poi["bar"].lat, cfg.poi["bar"].lon, hh=23, mm=0, seq=19, db=85.0)
    p2["sent_at_ms"] = t0 + 19_000
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(p2).encode())
    # Harus DITOLAK
    assert srv.latest_anak.sequence == 20
    assert len(published) == 1


def test_sequence_turun_lebih_dari_1000_tetapi_timestamp_lama_ditolak(server_fixture):
    srv, published, cfg = server_fixture
    # Paket seq 1500 pada t=1500s
    t0 = epoch_ms(9, 0)
    p1 = anak_payload(cfg.poi["kampus"].lat, cfg.poi["kampus"].lon, hh=9, mm=0, seq=1500, db=50.0)
    p1["sent_at_ms"] = t0 + 1_500_000
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(p1).encode())
    assert srv.latest_anak.sequence == 1500
    assert len(published) == 1

    # Paket lama seq 50 (selisih sequence 1450 > 1000) tapi timestamp masa lalu (t=50s)
    p2 = anak_payload(cfg.poi["bar"].lat, cfg.poi["bar"].lon, hh=23, mm=0, seq=50, db=85.0)
    p2["sent_at_ms"] = t0 + 50_000
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(p2).encode())
    # Harus DITOLAK: tidak boleh dianggap sesi baru hanya karena selisih > 1000
    assert srv.latest_anak.sequence == 1500
    assert len(published) == 1


def test_perangkat_restart_sequence_kembali_ke_1_timestamp_baru_diterima(server_fixture):
    srv, published, cfg = server_fixture
    # Paket seq 50 pada t=50s
    t_start = epoch_ms(22, 50)
    p1 = anak_payload(cfg.poi["kampus"].lat, cfg.poi["kampus"].lon, hh=9, mm=0, seq=50, db=50.0)
    p1["sent_at_ms"] = t_start
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(p1).encode())
    assert srv.latest_anak.sequence == 50
    assert len(published) == 1

    # Perangkat restart, sequence kembali ke 1 dengan timestamp maju jam 23:00 (jam malam)
    t_restart = epoch_ms(23, 0)
    p2 = anak_payload(cfg.poi["bar"].lat, cfg.poi["bar"].lon, hh=23, mm=0, seq=1, db=85.0)
    p2["sent_at_ms"] = t_restart
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(p2).encode())
    # Harus DITERIMA: client restart sah
    assert srv.latest_anak.sequence == 1
    assert len(published) == 2
    assert published[1][1]["status"] == "CRITICAL_TERDETEKSI_DI_BAR"


def test_perangkat_restart_setelah_jeda_stale_diterima(server_fixture):
    srv, published, cfg = server_fixture
    current_time = 1_790_000_000.0
    srv._clock = lambda: current_time

    # Paket seq 50 pada t=50s
    t_start = epoch_ms(22, 50)
    p1 = anak_payload(cfg.poi["kampus"].lat, cfg.poi["kampus"].lon, hh=9, mm=0, seq=50, db=50.0)
    p1["sent_at_ms"] = t_start
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(p1).encode())
    assert srv.latest_anak.sequence == 50

    # Terjadi jeda idle panjang melebihi batas stale (default 60s, di sini 65s)
    current_time += 65.0

    # Perangkat restart kembali ke sequence 1 (bahkan jika jam sent_at perangkat simulator sama/mundur)
    p2 = anak_payload(cfg.poi["bar"].lat, cfg.poi["bar"].lon, hh=23, mm=0, seq=1, db=85.0)
    p2["sent_at_ms"] = t_start - 1000
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(p2).encode())
    # Harus DITERIMA karena sequence 1 setelah jeda stale
    assert srv.latest_anak.sequence == 1
    assert len(published) == 2
