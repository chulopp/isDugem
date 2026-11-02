"""Training Random Forest + Isolation Forest isDugem -> ml/model.joblib.

Jalankan dari folder server/ (setelah generate_dataset):
    python -m ml.train_model
    python -m ml.train_model --data ml/data/synthetic_dataset.csv --out ml/model.joblib

Keluaran:
    ml/model.joblib                     bundle {rf, iso, feature_names, meta}
    ml/artifacts/training_report.json   metrik untuk laporan / PPT (akurasi, F1, CV)
    ml/artifacts/feature_importances.json   bahan grafik XAI untuk Anggota 3 (Dashboard)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import joblib  # noqa: E402
import numpy as np  # noqa: E402
import sklearn  # noqa: E402
from sklearn.ensemble import IsolationForest, RandomForestClassifier  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split  # noqa: E402

from config import load_config  # noqa: E402
from ml.generate_dataset import (  # noqa: E402
    DEFAULT_CSV,
    DEFAULT_SEED,
    generate_samples,
    read_csv,
    write_csv,
)
from models import ALL_STATUSES, Status  # noqa: E402
from processing.decision_engine import (  # noqa: E402
    FEATURE_NAMES,
    ML_BUNDLE_VERSION,
    config_fingerprint,
)

ML_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL = ML_DIR / "model.joblib"
ARTIFACT_DIR = ML_DIR / "artifacts"
REAL_FIELD_JSON = ML_DIR / "data" / "real_field_samples.json"

# Isolation Forest dilatih HANYA pada perilaku mahasiswa normal (PRD 15.3.B): kuliah tenang,
# istirahat di kos, dan kondisi NORMAL yang berada di dalam geofence aman (kampus/masjid/kos).
# Rekaman NORMAL di luar geofence (jalanan, sekitar bar) tidak dianggap "pola normal".
NORMAL_LABELS = (Status.SEDANG_KULIAH, Status.ISTIRAHAT_DI_KOS, Status.NORMAL)
IMPOSSIBLE_SPEED_MPS = 70.0   # ~252 km/jam; hanya untuk uji "anomali tak terduga"

RF_PARAMS: Dict[str, Any] = dict(
    n_estimators=100,        # PRD 15.3.A: 100 pohon
    max_depth=10,            # batasi kedalaman -> cegah overfitting + model kecil
    min_samples_leaf=8,
    random_state=DEFAULT_SEED,
    n_jobs=1,
)
ISO_PARAMS: Dict[str, Any] = dict(
    n_estimators=50,         # 50 pohon cukup untuk skor stabil; menjaga latensi inferensi rendah
    max_samples=256,
    contamination=0.02,      # 2% data latih dianggap outlier -> ambang score < 0
    random_state=DEFAULT_SEED,
    n_jobs=1,
)


def _matrix(rows: Sequence[Dict[str, Any]]) -> np.ndarray:
    return np.asarray([[r[name] for name in FEATURE_NAMES] for r in rows], dtype=float)


def _labels(rows: Sequence[Dict[str, Any]]) -> np.ndarray:
    return np.asarray([r["label"] for r in rows])


def _safe_zone_mask(X: np.ndarray, radii: Dict[str, float]) -> np.ndarray:
    ix = {n: i for i, n in enumerate(FEATURE_NAMES)}
    return (
        (X[:, ix["dist_kampus_m"]] <= radii["kampus"])
        | (X[:, ix["dist_masjid_m"]] <= radii["masjid"])
        | (X[:, ix["dist_kos_m"]] <= radii["kos"])
    )


def _normal_mask(X: np.ndarray, y: np.ndarray, radii: Dict[str, float]) -> np.ndarray:
    base = np.isin(y, (Status.SEDANG_KULIAH, Status.ISTIRAHAT_DI_KOS))
    return base | ((y == Status.NORMAL) & _safe_zone_mask(X, radii))


def _print_confusion(cm: np.ndarray, classes: List[str]) -> None:
    short = [c[:10] for c in classes]
    print("\nConfusion Matrix (baris = aktual, kolom = prediksi)")
    print(" " * 28 + " ".join(f"{s:>10}" for s in short))
    for name, row in zip(classes, cm):
        print(f"{name:<28}" + " ".join(f"{v:>10d}" for v in row))


def train_bundle(
    rows: Sequence[Dict[str, Any]],
    cfg: Any = None,
    seed: int = DEFAULT_SEED,
    test_size: float = 0.2,
    verbose: bool = True,
    run_cv: bool = True,
) -> Dict[str, Any]:
    """Latih kedua model. Return bundle siap di-dump + metrik di bundle['meta']."""
    cfg = cfg or load_config()
    X, y = _matrix(rows), _labels(rows)
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=test_size, stratify=y, random_state=seed)

    # --- Random Forest: 5-Fold Stratified CV pada data latih, lalu uji pada hold-out ---
    if run_cv:
        cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
        cv_acc = cross_val_score(RandomForestClassifier(**RF_PARAMS), X_tr, y_tr, cv=cv, scoring="accuracy")
        cv_f1 = cross_val_score(RandomForestClassifier(**RF_PARAMS), X_tr, y_tr, cv=cv, scoring="f1_macro")
    else:  # dipakai unit test agar cepat
        cv_acc = cv_f1 = np.asarray([float("nan")])

    rf = RandomForestClassifier(**RF_PARAMS).fit(X_tr, y_tr)
    pred = rf.predict(X_te)
    classes = [str(c) for c in rf.classes_]
    acc = float(accuracy_score(y_te, pred))
    f1m = float(f1_score(y_te, pred, average="macro"))
    train_acc = float(accuracy_score(y_tr, rf.predict(X_tr)))

    # --- Isolation Forest: unsupervised, hanya data perilaku normal ---
    radii = cfg.radii_m
    train_normal = _normal_mask(X_tr, y_tr, radii)
    iso = IsolationForest(**ISO_PARAMS).fit(X_tr[train_normal])

    flagged_te = iso.decision_function(X_te) < 0
    test_normal = _normal_mask(X_te, y_te, radii)
    fake_mask = y_te == Status.ANOMALY_FAKE_GPS
    fake_recall = float(flagged_te[fake_mask].mean()) if fake_mask.any() else float("nan")
    normal_fpr = float(flagged_te[test_normal].mean()) if test_normal.any() else float("nan")

    # Uji "anomali tak terduga": lonjakan kecepatan mustahil yang tidak ada di data latih
    rng = np.random.default_rng(seed)
    jumped = X_te[test_normal].copy()
    jumped[:, FEATURE_NAMES.index("speed_mps")] = rng.uniform(IMPOSSIBLE_SPEED_MPS, 400.0, len(jumped))
    speed_jump_recall = float((iso.decision_function(jumped) < 0).mean())

    importances = {n: float(v) for n, v in zip(FEATURE_NAMES, rf.feature_importances_)}

    metrics = {
        "rf_holdout_accuracy": acc,
        "rf_holdout_f1_macro": f1m,
        "rf_train_accuracy": train_acc,
        "rf_cv5_accuracy_mean": float(cv_acc.mean()),
        "rf_cv5_accuracy_std": float(cv_acc.std()),
        "rf_cv5_f1_macro_mean": float(cv_f1.mean()),
        "iso_fake_gps_recall": fake_recall,
        "iso_false_positive_rate_normal": normal_fpr,
        "iso_speed_jump_recall": speed_jump_recall,
    }

    if verbose:
        print(f"\n=== Random Forest ({len(X_tr)} latih / {len(X_te)} uji) ===")
        if run_cv:
            print(f"5-Fold Stratified CV  accuracy = {cv_acc.mean():.4f} +/- {cv_acc.std():.4f}")
            print(f"5-Fold Stratified CV  F1-macro = {cv_f1.mean():.4f}")
        print(f"Hold-out accuracy = {acc:.4f} | F1-macro = {f1m:.4f} | train accuracy = {train_acc:.4f}")
        _print_confusion(confusion_matrix(y_te, pred, labels=classes), classes)
        print("\nPrecision / Recall / F1 per kelas")
        print(classification_report(y_te, pred, labels=classes, digits=4, zero_division=0))
        print("Feature importance")
        for name, val in sorted(importances.items(), key=lambda kv: -kv[1]):
            print(f"  {name:<14} {val:.4f}")
        print("\n=== Isolation Forest (unsupervised, data normal saja) ===")
        print(f"Dilatih pada {int(train_normal.sum())} sampel perilaku normal")
        print(f"Porsi kelas ANOMALY_FAKE_GPS yang ditandai IF  : {fake_recall:.4f}")
        print(f"False positive rate pada data normal (uji)    : {normal_fpr:.4f}")
        print(f"Recall lonjakan kecepatan >= {IMPOSSIBLE_SPEED_MPS:.0f} m/s      : {speed_jump_recall:.4f}")
        print("Catatan: status ANOMALY_FAKE_GPS diputuskan Random Forest; IF = skor outlier pendamping.")

    return {
        "bundle_version": ML_BUNDLE_VERSION,
        "rf": rf,
        "iso": iso,
        "feature_names": FEATURE_NAMES,
        "meta": {
            "sklearn_version": sklearn.__version__,
            "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "n_samples": len(rows),
            "seed": seed,
            "config_fingerprint": config_fingerprint(cfg),
            "classes": classes,
            "rf_params": RF_PARAMS,
            "iso_params": ISO_PARAMS,
            "metrics": metrics,
            "feature_importances": importances,
        },
    }


def evaluate_real_field(bundle: Dict[str, Any], path: Path = REAL_FIELD_JSON) -> Optional[float]:
    """Opsional (PRD 15.2 poin 4): uji hold-out data lapangan asli dari Anggota 1.

    Format yang diharapkan: JSON list; tiap elemen memuat 8 kunci fitur
    (FEATURE_NAMES) + "label" (salah satu enum status). Elemen yang tidak lengkap dilewati.
    """
    if not path.is_file():
        print(f"\n[INFO] {path.name} belum ada - evaluasi data lapangan dilewati.")
        return None
    try:
        raw_data = json.loads(path.read_text(encoding="utf-8"))
        samples = raw_data.get("samples", [])
    except (json.JSONDecodeError, TypeError) as exc:
        print(f"\n[WARN] {path.name} tidak terbaca ({exc}); evaluasi data lapangan dilewati.")
        return None

    from processing.decision_engine import minute_of_day, build_feature_vector, Context
    from processing.haversine import haversine_distance_m
    from config import load_config
    from datetime import datetime
    
    cfg = load_config()
    usable = []
    
    for r in samples:
        if r.get("audio_mode") != "raw": 
            continue # Adaptasi Wendi: jangan pakai data mode default
        if "label" not in r or r["label"] not in ALL_STATUSES: 
            continue
            
        try:
            # 1. Hitung fitur jarak dari titik pusat server
            lat, lon = float(r["lat"]), float(r["lon"])
            dist_kampus = haversine_distance_m(lat, lon, cfg.poi["kampus"].lat, cfg.poi["kampus"].lon)
            dist_masjid = haversine_distance_m(lat, lon, cfg.poi["masjid"].lat, cfg.poi["masjid"].lon)
            dist_kos = haversine_distance_m(lat, lon, cfg.poi["kos"].lat, cfg.poi["kos"].lon)
            dist_bar = haversine_distance_m(lat, lon, cfg.poi["bar"].lat, cfg.poi["bar"].lon)
            
            # 2. Ekstrak dB dan speed
            db = float(r.get("db", 0.0))
            speed = float(r.get("speed_mps", 0.0))
            
            # 3. Ekstrak waktu (dari format "HH:MM" Wendi)
            local_time_str = r.get("local_time", "00:00")
            hh, mm = map(int, local_time_str.split(":"))
            dummy_dt = datetime(2026, 1, 1, hh, mm)
            minute = minute_of_day(dummy_dt)
            
            # Buat Context sementara untuk mengekstrak vektor
            ctx = Context(
                time_label="lainnya", 
                distance_kampus_m=dist_kampus, distance_masjid_m=dist_masjid,
                distance_kos_m=dist_kos, distance_bar_m=dist_bar,
                db_level=db, claimed_at_kos=(dist_kos <= cfg.poi["kos"].radius_m)
            )
            
            vec = build_feature_vector(ctx, minute, speed)
            row = {name: val for name, val in zip(FEATURE_NAMES, vec)}
            row["label"] = r["label"]
            usable.append(row)
            
        except (ValueError, TypeError, KeyError):
            continue

    if not usable:
        print(f"\n[WARN] {path.name} tidak memuat rekaman berformat fitur+label yang valid; dilewati.")
        return None
        
    pred = bundle["rf"].predict(_matrix(usable))
    acc = float(accuracy_score(_labels(usable), pred))
    print(f"\n=== Hold-out data lapangan asli ({len(usable)} rekaman) accuracy = {acc:.4f} ===")
    return acc


def main() -> None:
    parser = argparse.ArgumentParser(description="Training model ML isDugem")
    parser.add_argument("--data", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--out", type=Path, default=DEFAULT_MODEL)
    args = parser.parse_args()

    cfg = load_config()
    if not args.data.is_file():
        print(f"[INFO] {args.data} belum ada -> membuat 5.000 sampel dulu")
        write_csv(generate_samples(5000, DEFAULT_SEED, cfg), args.data)

    rows = read_csv(args.data)
    bundle = train_bundle(rows, cfg)
    real_acc = evaluate_real_field(bundle)
    if real_acc is not None:
        bundle["meta"]["metrics"]["real_field_accuracy"] = real_acc

    args.out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, args.out, compress=("xz", 3))

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    (ARTIFACT_DIR / "training_report.json").write_text(
        json.dumps(bundle["meta"], indent=2, ensure_ascii=False), encoding="utf-8"
    )
    (ARTIFACT_DIR / "feature_importances.json").write_text(
        json.dumps(bundle["meta"]["feature_importances"], indent=2), encoding="utf-8"
    )
    print(f"\n[OK] Model disimpan: {args.out} ({args.out.stat().st_size / 1024:.1f} KB)")
    print(f"[OK] Laporan metrik : {ARTIFACT_DIR / 'training_report.json'}")


if __name__ == "__main__":
    main()