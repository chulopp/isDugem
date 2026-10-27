"""Tes end-to-end logika server tanpa broker (tambahan di luar daftar PRD)."""
import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from config import load_config
from main import GuardianServer
from models import ALL_STATUSES, AnakTelemetry, OrtuTelemetry, PayloadError, Status

WIB = ZoneInfo("Asia/Jakarta")


def epoch_ms(hh, mm):
    return int(datetime(2026, 10, 26, hh, mm, tzinfo=WIB).timestamp() * 1000)


def anak_payload(lat, lon, rms=0.001, hh=9, mm=0, seq=1, db=None):
    audio = {"rms": rms}
    if db is not None:
        audio["db"] = db
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
def server(env):
    cfg = load_config(env)
    sent = []
    srv = GuardianServer(cfg, publish=lambda topic, payload: sent.append((topic, payload)),
                         clock=lambda: 1_790_000_000.0)
    return srv, sent, cfg


def push(srv, cfg, payload):
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(payload).encode())


def test_topik_sesuai_kontrak(server):
    _, _, cfg = server
    assert cfg.topic_alerts == "rantauguard/isdugem_tim_01/alerts"
    assert cfg.topic_anak_telemetry == "rantauguard/isdugem_tim_01/edge/anak/telemetry"


def test_skenario_sedang_kuliah(server):
    srv, sent, cfg = server
    push(srv, cfg, anak_payload(cfg.poi['kampus'].lat, cfg.poi['kampus'].lon, rms=0.001, hh=9))   # 40 dB, di kampus
    assert sent[-1][0] == cfg.topic_alerts
    assert sent[-1][1]["status"] == Status.SEDANG_KULIAH
    assert sent[-1][1]["context"]["time_label"] == "jam_kuliah"


def test_skenario_bolos(server):
    srv, sent, cfg = server
    push(srv, cfg, anak_payload(cfg.poi['bar'].lat, cfg.poi['bar'].lon, hh=10))           # di bar saat jam kuliah
    assert sent[-1][1]["status"] == Status.ALERT_BOLOS_KULIAH


def test_skenario_warning_masjid_pada_jam_dzuhur(server):
    srv, sent, cfg = server
    push(srv, cfg, anak_payload(cfg.poi['kos'].lat, cfg.poi['kos'].lon, hh=12, mm=5))      # di kos saat dzuhur
    assert sent[-1][1]["status"] == Status.WARNING_BELUM_KE_MASJID


def test_skenario_bar_malam(server):
    srv, sent, cfg = server
    push(srv, cfg, anak_payload(cfg.poi['bar'].lat, cfg.poi['bar'].lon, rms=0.12, hh=23, mm=10))  # ~81.6 dB
    payload = sent[-1][1]
    assert payload["status"] == Status.CRITICAL_TERDETEKSI_DI_BAR
    assert payload["context"]["nearest_poi"] == "bar"
    assert "23:10" in payload["reason"]


def test_skenario_andalan_anomaly_fake_gps(server):
    srv, sent, cfg = server
    push(srv, cfg, anak_payload(cfg.poi['kos'].lat, cfg.poi['kos'].lon, rms=0.2, hh=23, mm=30))   # ~86 dB di kos
    assert sent[-1][1]["status"] == Status.ANOMALY_FAKE_GPS


def test_skenario_istirahat_di_kos(server):
    srv, sent, cfg = server
    push(srv, cfg, anak_payload(cfg.poi['kos'].lat, cfg.poi['kos'].lon, rms=0.0005, hh=23, mm=30))  # ~34 dB
    assert sent[-1][1]["status"] == Status.ISTIRAHAT_DI_KOS


def test_publish_hanya_saat_status_berubah(server):
    srv, sent, cfg = server
    push(srv, cfg, anak_payload(cfg.poi['kampus'].lat, cfg.poi['kampus'].lon, seq=1))
    push(srv, cfg, anak_payload(cfg.poi['kampus'].lat, cfg.poi['kampus'].lon, seq=2))
    push(srv, cfg, anak_payload(cfg.poi['kampus'].lat, cfg.poi['kampus'].lon, seq=3))
    assert len(sent) == 1
    push(srv, cfg, anak_payload(cfg.poi['bar'].lat, cfg.poi['bar'].lon, seq=4))   # pindah -> bolos
    assert len(sent) == 2


def test_duplikat_qos1_dibuang(server):
    srv, sent, cfg = server
    p = anak_payload(cfg.poi['kampus'].lat, cfg.poi['kampus'].lon, seq=7)
    push(srv, cfg, p)
    push(srv, cfg, p)
    assert len(sent) == 1
    assert srv.latest_anak.sequence == 7


def test_payload_alert_sesuai_skema(server):
    srv, sent, cfg = server
    push(srv, cfg, anak_payload(cfg.poi['kampus'].lat, cfg.poi['kampus'].lon))
    alert = sent[-1][1]
    assert set(alert) == {"status", "reason", "timestamp_ms", "context"}
    assert set(alert["context"]) == {"time_label", "nearest_poi", "distance_m", "db"}
    assert alert["status"] in ALL_STATUSES
    assert alert["timestamp_ms"] == 1_790_000_000_000


def test_payload_rusak_tidak_membuat_server_crash(server):
    srv, sent, cfg = server
    srv.handle_message(cfg.topic_anak_telemetry, b"bukan json")
    srv.handle_message(cfg.topic_anak_telemetry, b'{"location": {"lat": "x"}}')
    srv.handle_message(cfg.topic_anak_telemetry, b'{"location": {"lat": 95, "lon": 0}, "audio": {"rms": 1}}')
    assert sent == []


def test_ping_republish_alert_terakhir(server):
    srv, sent, cfg = server
    push(srv, cfg, anak_payload(cfg.poi['kampus'].lat, cfg.poi['kampus'].lon))
    srv.handle_message(
        cfg.topic_command_ping,
        json.dumps({"triggered_by": "ortu", "timestamp_ms": 1, "message": "cek"}).encode(),
    )
    assert len(sent) == 2
    assert sent[1][1]["status"] == sent[0][1]["status"]


def test_ping_tanpa_alert_sebelumnya_tidak_publish(server):
    srv, sent, cfg = server
    srv.handle_message(cfg.topic_command_ping, b'{"triggered_by": "dashboard"}')
    assert sent == []


def test_telemetri_ortu_disimpan(server):
    srv, _, cfg = server
    payload = {
        "device_id": "ortu", "sequence": 3, "sent_at_ms": 1,
        "location": {"lat": -7.054, "lon": 110.438},
        "motion": {"accel_magnitude": 20.0, "shake_detected": True},
    }
    srv.handle_message(cfg.topic_ortu_telemetry, json.dumps(payload).encode())
    assert srv.latest_ortu.shake_detected is True


def test_db_dihitung_dari_rms_bukan_dari_field_db(server):
    srv, sent, cfg = server
    # rms 0.2 -> ~86 dB walau field db mengaku 40 -> tetap ANOMALY (server = sumber hitung)
    push(srv, cfg, anak_payload(cfg.poi['kos'].lat, cfg.poi['kos'].lon, rms=0.2, db=40.0, hh=23, mm=30))
    assert sent[-1][1]["status"] == Status.ANOMALY_FAKE_GPS


def test_fallback_ke_field_db_jika_rms_tidak_ada(server):
    srv, sent, cfg = server
    payload = anak_payload(cfg.poi['kos'].lat, cfg.poi['kos'].lon, hh=23, mm=30)
    payload["audio"] = {"db": 90.0}
    push(srv, cfg, payload)
    assert sent[-1][1]["status"] == Status.ANOMALY_FAKE_GPS

def test_heartbeat_publish_ulang(env, monkeypatch):
    monkeypatch.setenv("ALERT_HEARTBEAT_S", "30")
    cfg = load_config(env)
    now = [1_790_000_000.0]
    sent = []
    srv = GuardianServer(cfg, lambda t, p: sent.append(p), clock=lambda: now[0])
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(anak_payload(cfg.poi['kampus'].lat, cfg.poi['kampus'].lon, seq=1)).encode())
    now[0] += 10
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(anak_payload(cfg.poi['kampus'].lat, cfg.poi['kampus'].lon, seq=2)).encode())
    assert len(sent) == 1
    now[0] += 25
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(anak_payload(cfg.poi['kampus'].lat, cfg.poi['kampus'].lon, seq=3)).encode())
    assert len(sent) == 2


def test_use_server_clock(env, monkeypatch):
    monkeypatch.setenv("USE_SERVER_CLOCK", "true")
    cfg = load_config(env)
    sent = []
    # 1_790_000_000 s = 2026-09-21 ~ 13:33 WIB -> 'lainnya' -> NORMAL walau sent_at_ms bilang 09:00
    srv = GuardianServer(cfg, lambda t, p: sent.append(p), clock=lambda: 1_790_000_000.0)
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(anak_payload(cfg.poi['kampus'].lat, cfg.poi['kampus'].lon, hh=9)).encode())
    assert sent[-1]["context"]["time_label"] == "lainnya"


def test_validasi_model_telemetri():
    with pytest.raises(PayloadError):
        AnakTelemetry.from_payload({"location": {"lat": 1, "lon": 1}, "audio": {}})
    with pytest.raises(PayloadError):
        AnakTelemetry.from_payload({"device_id": "ortu", "location": {"lat": 1, "lon": 1}, "audio": {"rms": 1}})
    with pytest.raises(PayloadError):
        OrtuTelemetry.from_payload({"location": {"lat": 1, "lon": 1}, "motion": {"shake_detected": "ya"}})



def test_sequence_lama_tidak_mengganti_latest_anak(server):
    srv = server[0]

    srv.handle_message(
        srv.cfg.topic_anak_telemetry,
        json.dumps(anak_payload(seq=7, lat=-6.2000, lon=106.8166)).encode("utf-8"),
    )
    latest = srv.latest_anak

    srv.handle_message(
        srv.cfg.topic_anak_telemetry,
        json.dumps(anak_payload(seq=6, lat=-6.2000, lon=106.8166)).encode("utf-8"),
    )

    assert srv.latest_anak is latest
    assert srv.latest_anak.sequence == 7


def test_anak_telemetry_stale_setelah_batas_waktu(server):
    srv, _, cfg = server
    now = [1_790_000_000.0]
    srv._clock = lambda: now[0]

    assert srv.anak_telemetry_stale is True

    srv._last_anak_received_s = now[0]
    assert srv.anak_telemetry_stale is False

    now[0] += cfg.telemetry_stale_after_s + 1
    assert srv.anak_telemetry_stale is True


def test_publish_alert_menunggu_konfirmasi_sukses(server):
    srv, _, cfg = server
    srv._publish = lambda topic, payload: 501

    push(
        srv,
        cfg,
        anak_payload(
            cfg.poi["kampus"].lat,
            cfg.poi["kampus"].lon,
        ),
    )

    assert srv.current_status is None
    assert 501 in srv._pending_alerts

    expected_status = srv._pending_alerts[501][0].status
    srv.handle_publish_confirm(501, True)

    assert srv.current_status == expected_status
    assert srv.last_alert is not None
    assert srv.last_alert.status == expected_status
    assert 501 not in srv._pending_alerts


def test_publish_alert_gagal_tidak_mengubah_status(server):
    srv, _, cfg = server
    srv._publish = lambda topic, payload: 502

    push(
        srv,
        cfg,
        anak_payload(
            cfg.poi["kampus"].lat,
            cfg.poi["kampus"].lon,
        ),
    )

    assert srv.current_status is None
    assert 502 in srv._pending_alerts

    srv.handle_publish_confirm(502, False)

    assert srv.current_status is None
    assert srv.last_alert is None
    assert 502 not in srv._pending_alerts


def test_konfirmasi_mid_tidak_dikenal_diabaikan(server):
    srv, _, cfg = server
    srv._publish = lambda topic, payload: 503

    push(
        srv,
        cfg,
        anak_payload(
            cfg.poi["kampus"].lat,
            cfg.poi["kampus"].lon,
        ),
    )

    pending_before = dict(srv._pending_alerts)

    srv.handle_publish_confirm(999, True)

    assert srv.current_status is None
    assert srv.last_alert is None
    assert srv._pending_alerts == pending_before

def test_anak_telemetry_kembali_fresh_setelah_data_baru(server):
    srv, _, cfg = server
    now = [1_790_000_000.0]
    srv._clock = lambda: now[0]

    push(
        srv,
        cfg,
        anak_payload(
            cfg.poi["kampus"].lat,
            cfg.poi["kampus"].lon,
            seq=1,
        ),
    )
    assert srv.anak_telemetry_stale is False

    now[0] += cfg.telemetry_stale_after_s + 1
    assert srv.anak_telemetry_stale is True

    push(
        srv,
        cfg,
        anak_payload(
            cfg.poi["kampus"].lat,
            cfg.poi["kampus"].lon,
            seq=2,
        ),
    )
    assert srv.anak_telemetry_stale is False

def test_status_yang_sama_tidak_mengantrekan_alert_berulang_saat_pending(server):
    srv, _, cfg = server
    published = []

    def fake_publish(topic, payload):
        published.append((topic, payload))
        return 500 + len(published)

    srv._publish = fake_publish

    payload_pertama = anak_payload(
        cfg.poi["kampus"].lat,
        cfg.poi["kampus"].lon,
        seq=1,
    )

    payload_kedua = anak_payload(
        cfg.poi["kampus"].lat,
        cfg.poi["kampus"].lon,
        seq=2,
    )

    push(srv, cfg, payload_pertama)
    jumlah_setelah_pertama = len(published)

    push(srv, cfg, payload_kedua)

    assert len(published) == jumlah_setelah_pertama

def test_konfirmasi_lama_tidak_mengembalikan_status_ke_alert_lama(server):
    srv, _, cfg = server
    published = []

    def fake_publish(topic, payload):
        mid = 600 + len(published)
        published.append((mid, payload))
        return mid

    srv._publish = fake_publish

    # Alert pertama: lokasi kampus.
    push(
        srv,
        cfg,
        anak_payload(
            cfg.poi["kampus"].lat,
            cfg.poi["kampus"].lon,
            seq=1,
        ),
    )

    assert len(published) == 1
    mid_a = published[0][0]

    # Konfirmasi alert pertama agar perubahan status berikutnya
    # dapat memicu alert baru.
    srv.handle_publish_confirm(mid_a, True)
    status_a = srv.current_status

    # Alert kedua harus berasal dari status yang berbeda.
    # Gunakan payload dari skenario yang memang menghasilkan
    # status berbeda dalam tes yang sudah ada.
    # Ganti payload di bawah dengan skenario tersebut.
    push(
        srv,
        cfg,
        anak_payload(
            cfg.poi["bar"].lat,
            cfg.poi["bar"].lon,
            seq=2,
        ),
    )

    assert len(published) == 2
    mid_b = published[1][0]
    status_b = published[1][1]["status"]

    assert status_b != status_a

    # Simulasikan konfirmasi B lebih dahulu, kemudian A.
    srv.handle_publish_confirm(mid_b, True)
    assert srv.current_status == status_b

    # MID A sudah dikonfirmasi sebelumnya, sehingga konfirmasi
    # ulang tidak boleh mengubah status B.
    srv.handle_publish_confirm(mid_a, True)
    assert srv.current_status == status_b

def test_konfirmasi_publish_tidak_membuat_status_mundur(server):
    srv, _, cfg = server
    published = []

    def fake_publish(topic, payload):
        mid = 600 + len(published)
        published.append((mid, payload))
        return mid

    srv._publish = fake_publish

    # Alert A masuk pending.
    push(
        srv,
        cfg,
        anak_payload(
            cfg.poi["kampus"].lat,
            cfg.poi["kampus"].lon,
            seq=1,
        ),
    )

    assert len(published) == 1
    mid_a = published[0][0]
    status_a = published[0][1]["status"]

    # Alert B harus berbeda status dan tetap bisa masuk pending.
    push(
        srv,
        cfg,
        anak_payload(
            cfg.poi["bar"].lat,
            cfg.poi["bar"].lon,
            seq=2,
        ),
    )

    assert len(published) == 2
    mid_b = published[1][0]
    status_b = published[1][1]["status"]

    assert status_b != status_a

    # Konfirmasi alert terbaru terlebih dahulu.
    srv.handle_publish_confirm(mid_b, True)
    assert srv.current_status == status_b

    # Konfirmasi alert lama datang belakangan.
    srv.handle_publish_confirm(mid_a, True)

    # Status tidak boleh mundur ke alert A.
    assert srv.current_status == status_b