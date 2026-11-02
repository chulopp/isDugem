"""Unit test ML engine isDugem (Anggota 2): latensi, agreement rate, fail-safe, kontrak ml_meta.

Fixture melatih model sendiri ke folder sementara dengan konfigurasi DEFAULT, sehingga test
tidak bergantung pada model.joblib yang dikomit maupun isi .env lokal.
"""
import json
import math
import statistics
import time
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

pytest.importorskip("sklearn")
pytest.importorskip("joblib")

import joblib  # noqa: E402

from config import load_config  # noqa: E402
from main import GuardianServer  # noqa: E402
from ml.generate_dataset import generate_samples  # noqa: E402
from ml.train_model import train_bundle  # noqa: E402
from models import ALL_STATUSES, AnakTelemetry, Status  # noqa: E402
from processing.decision_engine import (  # noqa: E402
    DEFAULT_MODEL_PATH,
    FEATURE_NAMES,
    MLEngine,
    SpeedTracker,
    build_context,
    build_feature_vector,
    classify,
    classify_ml,
    classify_with_fallback,
    get_time_label,
    load_ml_engine,
    minute_of_day,
)

WIB = ZoneInfo("Asia/Jakarta")
ENV_KEYS = (
    "PROJECT_ID", "TIMEZONE", "USE_SERVER_CLOCK", "ALERT_HEARTBEAT_S", "PING_REPUBLISH",
    "KULIAH_WINDOW", "SHOLAT_WINDOWS", "MALAM_WINDOW", "POI_KAMPUS", "POI_MASJID", "POI_KOS",
    "POI_BAR", "ML_ENABLED", "ML_MODEL_PATH", "ML_MODEL_SHA256",
)
LATENCY_BUDGET_MS = 10.0
AGREEMENT_TARGET = 0.95


@pytest.fixture(scope="module")
def cfg(tmp_path_factory):
    mp = pytest.MonkeyPatch()
    for key in ENV_KEYS:
        mp.delenv(key, raising=False)
    config = load_config(tmp_path_factory.mktemp("cfg") / "kosong.env")
    yield config
    mp.undo()


@pytest.fixture(scope="module")
def model_path(cfg, tmp_path_factory):
    rows = generate_samples(5000, seed=42, cfg=cfg)
    bundle = train_bundle(rows, cfg, verbose=False, run_cv=False)
    path = tmp_path_factory.mktemp("model") / "model.joblib"
    joblib.dump(bundle, path, compress=("xz", 3))
    return path


@pytest.fixture(scope="module")
def engine(cfg, model_path):
    return MLEngine.from_file(model_path, cfg=cfg)


def at(hh, mm, ss=0):
    return datetime(2026, 10, 26, hh, mm, ss, tzinfo=WIB)


def make_ctx(cfg, poi, db, local_dt, offset_deg=0.0):
    label = get_time_label(local_dt.time(), cfg.kuliah_window, cfg.sholat_windows, cfg.malam_window)
    p = cfg.poi[poi]
    return build_context(p.lat + offset_deg, p.lon, db, label, cfg.poi)


# ----------------------------------------------------------------- fitur & encoding
def test_vektor_fitur_8_dimensi_dan_urutan(cfg):
    ctx = make_ctx(cfg, "kampus", 50.0, at(9, 30))
    vec = build_feature_vector(ctx, minute_of_day(at(9, 30)), 1.2)
    assert len(vec) == len(FEATURE_NAMES) == 8
    assert FEATURE_NAMES[4:6] == ("db_level", "speed_mps")
    assert vec[4] == 50.0 and vec[5] == 1.2


def test_encoding_siklikal_menyambung_di_pergantian_hari(cfg):
    ctx = make_ctx(cfg, "kos", 40.0, at(23, 59))
    a = build_feature_vector(ctx, minute_of_day(at(23, 59)), 0.0)
    b = build_feature_vector(ctx, minute_of_day(at(0, 1)), 0.0)
    assert math.dist(a[6:], b[6:]) < 0.01                       # 23:59 dan 00:01 berdekatan
    assert math.isclose(a[6] ** 2 + a[7] ** 2, 1.0, abs_tol=1e-9)  # titik di lingkaran satuan
    assert math.dist(a[6:], build_feature_vector(ctx, 12 * 60, 0.0)[6:]) > 1.9  # 23:59 vs 12:00 jauh


# ----------------------------------------------------------------- latensi & agreement
def test_latensi_inferensi_di_bawah_10ms(cfg, engine):
    local = at(23, 10)
    ctx = make_ctx(cfg, "bar", 81.3, local)
    for _ in range(30):                                            # pemanasan
        classify_ml(ctx, local, None, engine)
    samples = []
    for _ in range(300):
        t0 = time.perf_counter()
        result = classify_ml(ctx, local, None, engine)
        samples.append((time.perf_counter() - t0) * 1000.0)
    assert result is not None
    samples.sort()
    p95 = samples[int(len(samples) * 0.95)]
    print(f"\nlatensi ms: mean={statistics.mean(samples):.2f} p95={p95:.2f} max={samples[-1]:.2f}")
    assert p95 < LATENCY_BUDGET_MS


def test_agreement_rate_terhadap_ground_truth_minimal_95_persen(cfg, engine):
    rows = generate_samples(1500, seed=2026, cfg=cfg)               # seed berbeda dari data latih
    hit = sum(
        engine.predict_vector([r[n] for n in FEATURE_NAMES])[0] == r["label"] for r in rows
    )
    rate = hit / len(rows)
    print(f"\nagreement rate = {rate:.4f} ({hit}/{len(rows)})")
    assert rate >= AGREEMENT_TARGET


def test_jalur_cepat_rf_identik_dengan_predict_proba_sklearn(cfg, engine):
    import numpy as np

    rows = generate_samples(200, seed=99, cfg=cfg)
    X = np.asarray([[r[n] for n in FEATURE_NAMES] for r in rows])
    reference = engine._rf.predict_proba(X)
    fast = np.vstack([engine._rf_proba(x.reshape(1, -1)) for x in X])
    assert engine._fast_rf is True
    assert np.allclose(reference, fast, atol=1e-9)


# ----------------------------------------------------------------- skenario demo (PRD 15.7)
CANONICAL = [
    # nama, poi, db, jam, status yang diharapkan
    ("kuliah", "kampus", 45.0, (9, 30), Status.SEDANG_KULIAH),
    ("bolos", "bar", 60.0, (10, 0), Status.ALERT_BOLOS_KULIAH),
    ("sholat", "kos", 50.0, (12, 10), Status.WARNING_BELUM_KE_MASJID),
    ("istirahat", "kos", 35.0, (23, 30), Status.ISTIRAHAT_DI_KOS),
    ("bar", "bar", 88.0, (23, 10), Status.CRITICAL_TERDETEKSI_DI_BAR),
    ("fake_gps", "kos", 95.0, (23, 30), Status.ANOMALY_FAKE_GPS),
    ("normal", "kampus", 60.0, (17, 0), Status.NORMAL),
]


@pytest.mark.parametrize("name,poi,db,hm,expected", CANONICAL, ids=[c[0] for c in CANONICAL])
def test_skenario_demo_sama_dengan_rule_based(cfg, engine, name, poi, db, hm, expected):
    local = at(*hm)
    ctx = make_ctx(cfg, poi, db, local)
    assert classify(ctx, cfg.radii_m) == expected                   # sanity: acuan rule-based
    result = classify_ml(ctx, local, None, engine)
    assert result is not None and result.status == expected


def test_bar_malam_suara_keras_confidence_di_atas_90_persen(cfg, engine):
    local = at(23, 10)
    result = classify_ml(make_ctx(cfg, "bar", 88.0, local), local, None, engine)
    assert result.status == Status.CRITICAL_TERDETEKSI_DI_BAR
    assert result.confidence > 0.90


def test_fake_gps_status_terdeteksi_dengan_skor_anomali_valid(cfg, engine):
    local = at(23, 30)
    result = classify_ml(make_ctx(cfg, "kos", 95.0, local), local, None, engine)
    assert result.status == Status.ANOMALY_FAKE_GPS
    assert math.isfinite(result.anomaly_score)
    assert isinstance(result.is_anomaly, bool)
    assert result.is_anomaly == (result.anomaly_score < 0)


def test_ml_meta_sesuai_kontrak(cfg, engine):
    local = at(9, 30)
    meta = classify_ml(make_ctx(cfg, "kampus", 45.0, local), local, None, engine).to_meta()
    assert set(meta) == {"engine", "confidence", "anomaly_score", "is_anomaly"}
    assert meta["engine"] == "RandomForest+IsolationForest"
    assert 0.0 <= meta["confidence"] <= 1.0
    assert isinstance(meta["is_anomaly"], bool)
    json.dumps(meta)                                                # harus serializable ke MQTT


# ----------------------------------------------------------------- fail-safe / fallback
def test_fallback_file_model_hilang_tidak_crash(cfg, tmp_path):
    assert load_ml_engine(cfg, tmp_path / "tidak_ada.joblib") is None


def test_fallback_file_model_korup(cfg, tmp_path):
    bad = tmp_path / "rusak.joblib"
    bad.write_bytes(b"ini bukan model")
    assert load_ml_engine(cfg, bad) is None


def test_fallback_sha256_tidak_cocok(cfg, model_path, monkeypatch):
    monkeypatch.setenv("ML_MODEL_SHA256", "0" * 64)
    assert load_ml_engine(cfg, model_path) is None
    import hashlib

    monkeypatch.setenv("ML_MODEL_SHA256", hashlib.sha256(model_path.read_bytes()).hexdigest())
    assert load_ml_engine(cfg, model_path) is not None


def test_fallback_konfigurasi_poi_berubah_sejak_training(model_path, tmp_path, monkeypatch):
    monkeypatch.setenv("POI_KOS", "-7.0700,110.4500,500")
    changed = load_config(tmp_path / "kosong.env")
    assert load_ml_engine(changed, model_path) is None              # model usang -> rule-based


def test_ml_dinonaktifkan_lewat_env(cfg, model_path, monkeypatch):
    monkeypatch.setenv("ML_ENABLED", "false")
    assert load_ml_engine(cfg, model_path) is None


def test_model_default_yang_dikomit_dapat_dimuat_jika_ada():
    if not DEFAULT_MODEL_PATH.is_file():
        pytest.skip("ml/model.joblib belum dibuat (jalankan train_model.py)")
    assert load_ml_engine(None, DEFAULT_MODEL_PATH) is not None


def test_classify_with_fallback_tanpa_engine_sama_dengan_rule_based(cfg):
    local = at(23, 10)
    ctx = make_ctx(cfg, "bar", 81.3, local)
    status, result = classify_with_fallback(ctx, local, None, cfg.radii_m, None)
    assert status == classify(ctx, cfg.radii_m) and result is None


def test_inferensi_error_fallback_ke_rule_based(cfg):
    class Rusak:
        def predict(self, *args, **kwargs):
            raise RuntimeError("model rusak")

    local = at(23, 10)
    ctx = make_ctx(cfg, "bar", 81.3, local)
    status, result = classify_with_fallback(ctx, local, None, cfg.radii_m, Rusak())
    assert status == classify(ctx, cfg.radii_m) and result is None


# ----------------------------------------------------------------- integrasi GuardianServer
def anak_payload(cfg, poi, rms, hh, mm, seq=1, speed=None):
    p = cfg.poi[poi]
    loc = {"lat": p.lat, "lon": p.lon, "accuracy_m": 8.5}
    if speed is not None:
        loc["speed_mps"] = speed
    return {
        "device_id": "anak",
        "sequence": seq,
        "sent_at_ms": int(datetime(2026, 10, 26, hh, mm, tzinfo=WIB).timestamp() * 1000) + seq,
        "location": loc,
        "audio": {"rms": rms},
        "motion": {"accel_magnitude": 9.9},
    }


def make_server(cfg, ml_engine=None):
    sent = []
    srv = GuardianServer(
        cfg, publish=lambda topic, payload: sent.append(payload),
        clock=lambda: 1_790_000_000.0, ml_engine=ml_engine,
    )
    return srv, sent


def push(srv, cfg, payload):
    srv.handle_message(cfg.topic_anak_telemetry, json.dumps(payload).encode())


def test_server_dengan_ml_menyertakan_ml_meta(cfg, engine):
    srv, sent = make_server(cfg, engine)
    push(srv, cfg, anak_payload(cfg, "bar", 0.12, 23, 10, speed=0.4))  # ~81.6 dB
    alert = sent[-1]
    assert alert["status"] == Status.CRITICAL_TERDETEKSI_DI_BAR
    assert set(alert) == {"status", "reason", "timestamp_ms", "context", "ml_meta"}
    assert set(alert["ml_meta"]) == {"engine", "confidence", "anomaly_score", "is_anomaly"}
    assert alert["reason"].startswith("Probabilitas ML ") and "23:10" in alert["reason"]


def test_server_tanpa_ml_payload_tetap_4_kunci_seperti_semula(cfg):
    srv, sent = make_server(cfg, None)
    push(srv, cfg, anak_payload(cfg, "kampus", 0.001, 9, 0))
    assert set(sent[-1]) == {"status", "reason", "timestamp_ms", "context"}


def test_server_engine_rusak_tetap_publish_rule_based(cfg):
    class Rusak:
        def predict(self, *args, **kwargs):
            raise RuntimeError("boom")

    srv, sent = make_server(cfg, Rusak())
    push(srv, cfg, anak_payload(cfg, "kampus", 0.001, 9, 0))
    assert sent[-1]["status"] == Status.SEDANG_KULIAH
    assert "ml_meta" not in sent[-1]


def test_ping_republish_mempertahankan_ml_meta(cfg, engine):
    srv, sent = make_server(cfg, engine)
    push(srv, cfg, anak_payload(cfg, "kampus", 0.001, 9, 0))
    srv.handle_message(cfg.topic_command_ping, json.dumps({"triggered_by": "ortu"}).encode())
    assert len(sent) == 2 and "ml_meta" in sent[1]
    assert sent[1]["status"] in ALL_STATUSES


# ----------------------------------------------------------------- speed_mps & SpeedTracker
def test_telemetri_speed_mps_opsional_dan_toleran():
    base = {
        "sequence": 1, "sent_at_ms": 1760000000000,
        "location": {"lat": -7.05, "lon": 110.44},
        "audio": {"rms": 0.01},
    }
    assert AnakTelemetry.from_payload(base).speed_mps is None
    for good, expected in ((0.4, 0.4), (3, 3.0)):
        base["location"]["speed_mps"] = good
        assert AnakTelemetry.from_payload(base).speed_mps == expected
    for bad in ("cepat", -1.0, float("nan"), float("inf"), True, None):
        base["location"]["speed_mps"] = bad
        assert AnakTelemetry.from_payload(base).speed_mps is None   # diabaikan, paket tidak ditolak


def test_speed_tracker_menghitung_dari_delta_koordinat():
    tr = SpeedTracker()
    assert tr.update(-7.05, 110.44, 100.0) is None                  # fix pertama
    v = tr.update(-7.05 + 100.0 / 111_320.0, 110.44, 110.0)        # ~100 m dalam 10 detik
    assert v == pytest.approx(10.0, rel=0.02)
    assert tr.update(-7.05, 110.44, 110.1) is None                  # selisih waktu terlalu kecil
    assert tr.update(-7.05, 110.44, 400.0) is None                  # terlalu lama = bukan fix berurutan