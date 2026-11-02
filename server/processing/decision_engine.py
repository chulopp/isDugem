from __future__ import annotations
from datetime import time
from typing import Dict, Mapping, Optional, Sequence, Tuple
from config import POI, rangeTime
from models import Context, Status  
from processing.haversine import haversine_distance_m
import hashlib
import json
import logging
import math
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, List

from models import ALL_STATUSES

JAM_KULIAH = "jam_kuliah"
WAKTU_SHOLAT = "waktu_sholat"
JAM_MALAM = "jam_malam"
LAINNYA = "lainnya"

DEFAULT_RADII_M: Dict[str, float] = {
    "kampus": 150.0,
    "masjid": 100.0,
    "kos": 750.0,
    "bar": 250.0,
}

DB_KULIAH_TENANG_MAX = 65.0   
DB_KOS_TENANG_MAX = 55.0      
DB_BAR_MIN = 75.0             
DB_ANOMALY_MIN = 80.0         

def get_time_label(
    local_time: time,
    kuliah: rangeTime,
    sholat: Sequence[rangeTime],
    malam: rangeTime,
) -> str:
   
    if any(window.contains(local_time) for window in sholat):
        return WAKTU_SHOLAT
    if malam.contains(local_time):
        return JAM_MALAM
    if kuliah.contains(local_time):
        return JAM_KULIAH
    return LAINNYA

def build_context(
    lat: float,
    lon: float,
    db_level: float,
    time_label: str,
    pois: Mapping[str, POI],
) -> Context:
    dist = {
        name: haversine_distance_m(lat, lon, poi.lat, poi.lon) for name, poi in pois.items()
    }
    return Context(
        time_label=time_label,
        distance_kampus_m=dist["kampus"],
        distance_masjid_m=dist["masjid"],
        distance_kos_m=dist["kos"],
        distance_bar_m=dist["bar"],
        db_level=db_level,
        claimed_at_kos=dist["kos"] <= pois["kos"].radius_m,
    )

def nearest_poi(ctx: Context) -> Tuple[str, float]:
    candidates = (
        ("kampus", ctx.distance_kampus_m),
        ("masjid", ctx.distance_masjid_m),
        ("kos", ctx.distance_kos_m),
        ("bar", ctx.distance_bar_m),
    )
    return min(candidates, key=lambda item: item[1])

def classify(ctx: Context, radii: Optional[Mapping[str, float]] = None) -> str:
    r = {**DEFAULT_RADII_M, **(radii or {})}

    if ctx.time_label == JAM_KULIAH:
        if ctx.distance_kampus_m > r["kampus"]:
            return Status.ALERT_BOLOS_KULIAH
        if ctx.db_level < DB_KULIAH_TENANG_MAX:
            return Status.SEDANG_KULIAH
        return Status.NORMAL

    if ctx.time_label == WAKTU_SHOLAT:
        if ctx.distance_masjid_m > r["masjid"]:
            return Status.WARNING_BELUM_KE_MASJID
        return Status.NORMAL

    if ctx.time_label == JAM_MALAM:
        at_kos = ctx.claimed_at_kos and ctx.distance_kos_m <= r["kos"]
        if at_kos and ctx.db_level > DB_ANOMALY_MIN:
            return Status.ANOMALY_FAKE_GPS
        if ctx.distance_bar_m <= r["bar"] and ctx.db_level > DB_BAR_MIN:
            return Status.CRITICAL_TERDETEKSI_DI_BAR
        if ctx.distance_kos_m <= r["kos"] and ctx.db_level < DB_KOS_TENANG_MAX:
            return Status.ISTIRAHAT_DI_KOS
        return Status.NORMAL

    return Status.NORMAL

def build_reason(
    status: str,
    ctx: Context,
    hhmm: str,
    radii: Optional[Mapping[str, float]] = None,
) -> str:
    r = {**DEFAULT_RADII_M, **(radii or {})}
    db = f"{ctx.db_level:.1f}"

    if status == Status.SEDANG_KULIAH:
        return f"Di area kampus ({ctx.distance_kampus_m:.0f}m), suara tenang {db} dB pada jam {hhmm}"
    if status == Status.ALERT_BOLOS_KULIAH:
        return (
            f"Jarak ke kampus {ctx.distance_kampus_m:.0f}m (> {r['kampus']:.0f}m) "
            f"saat jam kuliah, jam {hhmm}"
        )
    if status == Status.WARNING_BELUM_KE_MASJID:
        return (
            f"Jarak ke masjid {ctx.distance_masjid_m:.0f}m (> {r['masjid']:.0f}m) "
            f"pada waktu sholat, jam {hhmm}"
        )
    if status == Status.ISTIRAHAT_DI_KOS:
        return f"Di kos ({ctx.distance_kos_m:.0f}m), suara tenang {db} dB pada jam {hhmm}"
    if status == Status.CRITICAL_TERDETEKSI_DI_BAR:
        return f"Jarak ke bar {ctx.distance_bar_m:.0f}m, suara {db} dB pada jam {hhmm}"
    if status == Status.ANOMALY_FAKE_GPS:
        return (
            f"Lokasi klaim di kos ({ctx.distance_kos_m:.0f}m) tetapi suara {db} dB "
            f"pada jam {hhmm}: indikasi Fake GPS"
        )
    name, dist = nearest_poi(ctx)
    return f"Kondisi normal: terdekat {name} {dist:.0f}m, suara {db} dB pada jam {hhmm}"

_ml_log = logging.getLogger("rantauguard.ml")

FEATURE_NAMES: Tuple[str, ...] = (
    "dist_kampus_m",
    "dist_masjid_m",
    "dist_kos_m",
    "dist_bar_m",
    "db_level",
    "speed_mps",
    "time_sin",
    "time_cos",
)
ML_ENGINE_NAME = "RandomForest+IsolationForest"
ML_BUNDLE_VERSION = 1
DEFAULT_MODEL_PATH = Path(__file__).resolve().parent.parent / "ml" / "model.joblib"

DB_FEATURE_MIN = 0.0
DB_FEATURE_MAX = 120.0
SPEED_FEATURE_MAX_MPS = 500.0   # batas atas fitur agar nilai ekstrem tidak merusak array
SPEED_MIN_DT_S = 0.5            # selisih waktu minimum untuk estimasi kecepatan valid
SPEED_MAX_DT_S = 120.0          # lebih lama dari ini, dua fix tidak lagi "berurutan"


def minute_of_day(t: Any) -> float:
    """Menit sejak 00:00 (pecahan, termasuk detik) - dasar encoding siklikal waktu."""
    return t.hour * 60.0 + t.minute + t.second / 60.0 + t.microsecond / 60_000_000.0


def build_feature_vector(ctx: Context, minute: float, speed_mps: float) -> List[float]:
    """Vektor 8 fitur sesuai PRD 15.3.C. Urutan HARUS sama dengan FEATURE_NAMES."""
    angle = 2.0 * math.pi * (minute % 1440.0) / 1440.0
    db = max(DB_FEATURE_MIN, min(DB_FEATURE_MAX, float(ctx.db_level)))
    speed = max(0.0, min(SPEED_FEATURE_MAX_MPS, float(speed_mps)))
    return [
        float(ctx.distance_kampus_m),
        float(ctx.distance_masjid_m),
        float(ctx.distance_kos_m),
        float(ctx.distance_bar_m),
        db,
        speed,
        math.sin(angle),
        math.cos(angle),
    ]


def config_fingerprint(cfg: Any) -> str:
    """Sidik jari konfigurasi geofence + jendela waktu yang dipakai saat training.

    Label training diturunkan dari radius POI dan jendela waktu. Jika .env berubah
    setelah model dilatih, model menjadi usang dan harus dilatih ulang.
    """

    def window(r: Any) -> str:
        return f"{r.start.strftime('%H:%M')}-{r.end.strftime('%H:%M')}"

    payload = {
        "poi": {
            name: [round(p.lat, 6), round(p.lon, 6), round(p.radius_m, 1)]
            for name, p in sorted(cfg.poi.items())
        },
        "kuliah": window(cfg.kuliah_window),
        "sholat": [window(w) for w in cfg.sholat_windows],
        "malam": window(cfg.malam_window),
    }
    raw = json.dumps(payload, sort_keys=True).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


class SpeedTracker:
    """Estimasi kecepatan (m/s) dari dua fix GPS berurutan: haversine(delta) / delta waktu."""

    def __init__(self) -> None:
        self._prev: Optional[Tuple[float, float, float]] = None

    def update(self, lat: float, lon: float, t_s: float) -> Optional[float]:
        prev, self._prev = self._prev, (lat, lon, t_s)
        if prev is None:
            return None
        dt = t_s - prev[2]
        if dt < SPEED_MIN_DT_S or dt > SPEED_MAX_DT_S:
            return None
        return haversine_distance_m(prev[0], prev[1], lat, lon) / dt


@dataclass(frozen=True)
class MLResult:
    """Hasil inferensi satu telemetri."""

    status: str
    confidence: float      # probabilitas Random Forest untuk status akhir (0..1)
    anomaly_score: float   # decision_function Isolation Forest (<0 = anomali)
    is_anomaly: bool
    speed_mps: float = 0.0
    engine: str = ML_ENGINE_NAME

    def to_meta(self) -> Dict[str, Any]:
        """Objek `ml_meta` pada payload alert (PRD 15.4.B)."""
        return {
            "engine": self.engine,
            "confidence": round(float(self.confidence), 4),
            "anomaly_score": round(float(self.anomaly_score), 4),
            "is_anomaly": bool(self.is_anomaly),
        }

    def reason(self, base_reason: str) -> str:
        return f"Probabilitas ML {self.confidence * 100:.1f}%: {base_reason}"


class MLEngine:
    """Random Forest (status multi-kelas) + Isolation Forest (anomali Fake GPS)."""

    def __init__(self, bundle: Mapping[str, Any]) -> None:
        self._rf = bundle["rf"]
        self._iso = bundle["iso"]
        self._classes: List[str] = [str(c) for c in self._rf.classes_]
        self.meta: Dict[str, Any] = dict(bundle.get("meta", {}))
        if hasattr(self._rf, "n_jobs"):
            self._rf.n_jobs = 1  # inferensi 1 sampel: thread pool hanya menambah latensi
        self._speed = SpeedTracker()
        self._np = __import__("numpy")
        self._trees = [est.tree_ for est in self._rf.estimators_]
        self._fast_rf = True  # jalur cepat; dimatikan otomatis jika paritas dengan sklearn gagal

    @classmethod
    def from_file(
        cls,
        path: Path,
        expected_sha256: Optional[str] = None,
        cfg: Any = None,
    ) -> "MLEngine":
        path = Path(path)
        if not path.is_file():
            raise FileNotFoundError(f"file model tidak ditemukan: {path}")

        if expected_sha256:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            if digest.lower() != expected_sha256.strip().lower():
                raise ValueError("SHA-256 file model tidak cocok dengan ML_MODEL_SHA256")

        import joblib  # impor lambat: scikit-learn opsional
        import sklearn

        bundle = joblib.load(path)  # pickle: HANYA muat model dari sumber tepercaya
        if not isinstance(bundle, dict) or bundle.get("bundle_version") != ML_BUNDLE_VERSION:
            raise ValueError("format bundle model tidak dikenali (latih ulang dengan train_model.py)")
        if tuple(bundle.get("feature_names", ())) != FEATURE_NAMES:
            raise ValueError("urutan fitur model tidak sama dengan FEATURE_NAMES")

        trained_with = str(bundle.get("meta", {}).get("sklearn_version", ""))
        if trained_with.split(".")[:2] != sklearn.__version__.split(".")[:2]:
            raise ValueError(
                f"versi scikit-learn beda (model {trained_with}, runtime {sklearn.__version__}); latih ulang"
            )

        engine = cls(bundle)
        unknown = set(engine._classes) - set(ALL_STATUSES)
        if unknown:
            raise ValueError(f"kelas model di luar enum kontrak: {sorted(unknown)}")

        if cfg is not None:
            expected = bundle.get("meta", {}).get("config_fingerprint")
            actual = config_fingerprint(cfg)
            if expected != actual:
                raise ValueError(
                    "konfigurasi POI/jendela waktu berubah sejak training "
                    f"(model {expected}, runtime {actual}); jalankan ulang generate_dataset + train_model"
                )

        engine._warm_up()
        return engine

    def _warm_up(self) -> None:
        """Pemanasan + uji paritas jalur cepat RF terhadap predict_proba resmi sklearn."""
        np = self._np
        probes = np.asarray(
            [
                [500.0, 500.0, 500.0, 5000.0, 50.0, 0.5, 0.0, 1.0],
                [30.0, 640.0, 1500.0, 9000.0, 45.0, 0.2, -0.7, -0.7],
                [9000.0, 8800.0, 300.0, 9500.0, 92.0, 0.1, -0.2, 0.9],
                [5000.0, 4900.0, 4000.0, 100.0, 85.0, 3.0, -0.3, 0.9],
            ]
        )
        self._iso.decision_function(probes[:1])
        reference = self._rf.predict_proba(probes)
        fast = np.vstack([self._rf_proba(row.reshape(1, -1)) for row in probes])
        if not np.allclose(reference, fast, atol=1e-9):
            _ml_log.warning("Jalur cepat RF tidak paritas dengan sklearn; memakai predict_proba resmi")
            self._fast_rf = False

    def _rf_proba(self, arr: Any) -> Any:
        """Probabilitas kelas RF (1 baris). Rata-rata distribusi daun tiap pohon = predict_proba.

        Memanggil tree_.predict langsung melewati overhead validasi/joblib sklearn
        (~3.7 ms -> ~0.3 ms per prediksi) dengan hasil identik.
        """
        np = self._np
        if not self._fast_rf:
            return self._rf.predict_proba(arr)[0]
        x32 = np.ascontiguousarray(arr, dtype=np.float32)
        total = np.zeros(len(self._classes))
        for tree in self._trees:
            v = tree.predict(x32)[0]
            total += v / v.sum()
        return total / len(self._trees)

    def _resolve_speed(self, tel: Any) -> float:
        """Prioritas: estimasi server dari delta GPS > field speed_mps payload > 0.

        Mengikuti filosofi server yang sudah ada (dB dihitung server dari RMS, bukan
        dipercaya dari field klien): kecepatan dari koordinat sulit dipalsukan
        dibanding angka speed yang dilaporkan klien.
        """
        if tel is None:
            return 0.0
        estimated = None
        sent_at_ms = getattr(tel, "sent_at_ms", None)
        lat, lon = getattr(tel, "lat", None), getattr(tel, "lon", None)
        if sent_at_ms is not None and lat is not None and lon is not None:
            estimated = self._speed.update(float(lat), float(lon), sent_at_ms / 1000.0)
        if estimated is not None and math.isfinite(estimated):
            return estimated
        reported = getattr(tel, "speed_mps", None)
        if reported is not None and math.isfinite(reported) and reported >= 0:
            return float(reported)
        return 0.0

    def predict_vector(self, x: Sequence[float]) -> Tuple[str, float, float, bool]:
        """Inferensi murni dari vektor fitur (tanpa state). Return (status, conf, score, anomali)."""
        arr = self._np.asarray([list(x)], dtype=float)
        proba = self._rf_proba(arr)
        idx = int(proba.argmax())
        score = float(self._iso.decision_function(arr)[0])
        return self._classes[idx], float(proba[idx]), score, score < 0.0

    def predict(self, ctx: Context, local_dt: datetime, tel: Any = None) -> MLResult:
        """Status dari Random Forest; skor anomali dari Isolation Forest (metadata XAI)."""
        speed = self._resolve_speed(tel)
        x = build_feature_vector(ctx, minute_of_day(local_dt), speed)
        status, confidence, score, is_anomaly = self.predict_vector(x)
        return MLResult(
            status=status,
            confidence=confidence,
            anomaly_score=score,
            is_anomaly=is_anomaly,
            speed_mps=speed,
        )


def load_ml_engine(cfg: Any = None, path: Optional[Path] = None) -> Optional[MLEngine]:
    """Muat model dengan aman. Return None (=> rule-based) jika dinonaktifkan atau gagal.

    Env: ML_ENABLED (default true), ML_MODEL_PATH, ML_MODEL_SHA256 (opsional, integritas).
    """
    if os.getenv("ML_ENABLED", "true").strip().lower() in ("0", "false", "no", "n", "off"):
        _ml_log.info("ML dinonaktifkan via ML_ENABLED; memakai rule-based engine")
        return None

    model_path = Path(path or os.getenv("ML_MODEL_PATH") or DEFAULT_MODEL_PATH)
    try:
        engine = MLEngine.from_file(model_path, os.getenv("ML_MODEL_SHA256"), cfg)
    except Exception as exc:  # noqa: BLE001 - fail-safe: apa pun gagalnya, server harus hidup
        _ml_log.warning("Model ML tidak dapat dimuat (%s); fallback ke rule-based engine", exc)
        return None

    _ml_log.info("ML engine aktif: %s (%s)", ML_ENGINE_NAME, model_path)
    return engine


def classify_ml(
    ctx: Context,
    local_dt: datetime,
    tel: Any = None,
    engine: Optional[MLEngine] = None,
) -> Optional[MLResult]:
    """Inferensi ML. Return None jika engine tidak ada atau inferensi gagal (=> fallback)."""
    if engine is None:
        return None
    try:
        return engine.predict(ctx, local_dt, tel)
    except Exception:  # noqa: BLE001
        _ml_log.exception("Inferensi ML gagal; fallback ke rule-based engine untuk frame ini")
        return None


def classify_with_fallback(
    ctx: Context,
    local_dt: datetime,
    tel: Any = None,
    radii: Optional[Mapping[str, float]] = None,
    engine: Optional[MLEngine] = None,
) -> Tuple[str, Optional[MLResult]]:
    """Status dari ML bila tersedia, jika tidak dari classify() rule-based (perilaku lama)."""
    result = classify_ml(ctx, local_dt, tel, engine)
    if result is None:
        return classify(ctx, radii), None
    return result.status, result