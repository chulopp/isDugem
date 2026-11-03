import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split

from config import load_config
from ml.generate_dataset import (
    DEFAULT_CSV,
    DEFAULT_SEED,
    generate_samples,
    read_csv,
    write_csv,
)
from models import ALL_STATUSES, Status
from processing.decision_engine import (
    FEATURE_NAMES,
    ML_BUNDLE_VERSION,
    Context,
    build_feature_vector,
    config_fingerprint,
    minute_of_day,
)
from processing.haversine import haversine_distance_m

ML_DIR = Path(__file__).resolve().parent
DEFAULT_MODEL = ML_DIR / "model.joblib"
ARTIFACT_DIR = ML_DIR / "artifacts"
REAL_FIELD_JSON = ML_DIR / "data" / "real_field_samples.json"

IMPOSSIBLE_SPEED_MPS = 70.0

RF_PARAMS: Dict[str, Any] = dict(
    n_estimators=100,
    max_depth=10,
    min_samples_leaf=8,
    random_state=DEFAULT_SEED,
    n_jobs=1,
)
ISO_PARAMS: Dict[str, Any] = dict(
    n_estimators=50,
    max_samples=256,
    contamination=0.02,
    random_state=DEFAULT_SEED,
    n_jobs=1,
)


def _matrix(rows: Sequence[Dict[str, Any]]) -> np.ndarray:
    return np.asarray([[row[name] for name in FEATURE_NAMES] for row in rows], dtype=float)


def _labels(rows: Sequence[Dict[str, Any]]) -> np.ndarray:
    return np.asarray([row["label"] for row in rows])


def _normal_mask(X: np.ndarray, y: np.ndarray, radii: Dict[str, float]) -> np.ndarray:
    col = {name: i for i, name in enumerate(FEATURE_NAMES)}
    in_safe_zone = (
        (X[:, col["dist_kampus_m"]] <= radii["kampus"])
        | (X[:, col["dist_masjid_m"]] <= radii["masjid"])
        | (X[:, col["dist_kos_m"]] <= radii["kos"])
    )
    quiet_status = np.isin(y, (Status.SEDANG_KULIAH, Status.ISTIRAHAT_DI_KOS))
    normal_in_safe_zone = (y == Status.NORMAL) & in_safe_zone
    return quiet_status | normal_in_safe_zone


def _cross_validate(X_train: np.ndarray, y_train: np.ndarray, seed: int):
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
    accuracy = cross_val_score(RandomForestClassifier(**RF_PARAMS), X_train, y_train, cv=folds, scoring="accuracy")
    f1 = cross_val_score(RandomForestClassifier(**RF_PARAMS), X_train, y_train, cv=folds, scoring="f1_macro")
    return accuracy, f1


def train_bundle(
    rows: Sequence[Dict[str, Any]],
    cfg: Any = None,
    seed: int = DEFAULT_SEED,
    test_size: float = 0.2,
    verbose: bool = True,
    run_cv: bool = True,
) -> Dict[str, Any]:
    cfg = cfg or load_config()
    X, y = _matrix(rows), _labels(rows)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, stratify=y, random_state=seed
    )

    if run_cv:
        cv_acc, cv_f1 = _cross_validate(X_train, y_train, seed)
    else:
        cv_acc = cv_f1 = np.asarray([float("nan")])

    rf = RandomForestClassifier(**RF_PARAMS).fit(X_train, y_train)
    predicted = rf.predict(X_test)
    holdout_acc = float(accuracy_score(y_test, predicted))
    holdout_f1 = float(f1_score(y_test, predicted, average="macro"))
    train_acc = float(accuracy_score(y_train, rf.predict(X_train)))

    radii = cfg.radii_m
    iso = IsolationForest(**ISO_PARAMS).fit(X_train[_normal_mask(X_train, y_train, radii)])

    is_flagged = iso.decision_function(X_test) < 0
    test_normal = _normal_mask(X_test, y_test, radii)
    test_fake = y_test == Status.ANOMALY_FAKE_GPS
    fake_recall = float(is_flagged[test_fake].mean()) if test_fake.any() else float("nan")
    false_positive = float(is_flagged[test_normal].mean()) if test_normal.any() else float("nan")

    rng = np.random.default_rng(seed)
    jumped = X_test[test_normal].copy()
    speed_col = FEATURE_NAMES.index("speed_mps")
    jumped[:, speed_col] = rng.uniform(IMPOSSIBLE_SPEED_MPS, 400.0, len(jumped))
    speed_jump_recall = float((iso.decision_function(jumped) < 0).mean())

    importances = {name: float(v) for name, v in zip(FEATURE_NAMES, rf.feature_importances_)}
    metrics = {
        "rf_holdout_accuracy": holdout_acc,
        "rf_holdout_f1_macro": holdout_f1,
        "rf_train_accuracy": train_acc,
        "rf_cv5_accuracy_mean": float(cv_acc.mean()),
        "rf_cv5_accuracy_std": float(cv_acc.std()),
        "rf_cv5_f1_macro_mean": float(cv_f1.mean()),
        "iso_fake_gps_recall": fake_recall,
        "iso_false_positive_rate_normal": false_positive,
        "iso_speed_jump_recall": speed_jump_recall,
    }

    if verbose:
        print(f"Accuracy: {holdout_acc:.4f}")
        print(f"F1-Score: {holdout_f1:.4f}")

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
            "classes": [str(c) for c in rf.classes_],
            "rf_params": RF_PARAMS,
            "iso_params": ISO_PARAMS,
            "metrics": metrics,
            "feature_importances": importances,
        },
    }


def _extract_features_from_real_sample(record: Dict[str, Any], cfg: Any) -> Optional[Dict[str, Any]]:
    try:
        lat, lon = float(record["lat"]), float(record["lon"])
        db = float(record.get("db", 0.0))
        speed = float(record.get("speed_mps", 0.0))
        hour, minute = map(int, record.get("local_time", "00:00").split(":"))
        minute_of_day_value = minute_of_day(datetime(2026, 1, 1, hour, minute))

        def distance_to(poi_name: str) -> float:
            poi = cfg.poi[poi_name]
            return haversine_distance_m(lat, lon, poi.lat, poi.lon)

        ctx = Context(
            time_label="lainnya",
            distance_kampus_m=distance_to("kampus"),
            distance_masjid_m=distance_to("masjid"),
            distance_kos_m=distance_to("kos"),
            distance_bar_m=distance_to("bar"),
            db_level=db,
            claimed_at_kos=distance_to("kos") <= cfg.poi["kos"].radius_m,
        )
        features = build_feature_vector(ctx, minute_of_day_value, speed)
        row = dict(zip(FEATURE_NAMES, features))
        row["label"] = record["label"]
        return row
    except (ValueError, TypeError, KeyError):
        return None


def evaluate_real_field(bundle: Dict[str, Any], path: Path = REAL_FIELD_JSON) -> Optional[float]:
    if not path.is_file():
        return None
    try:
        samples = json.loads(path.read_text(encoding="utf-8")).get("samples", [])
    except (json.JSONDecodeError, TypeError, AttributeError):
        return None

    cfg = load_config()
    usable: List[Dict[str, Any]] = []
    for record in samples:
        if record.get("audio_mode") != "raw" or record.get("label") not in ALL_STATUSES:
            continue
        row = _extract_features_from_real_sample(record, cfg)
        if row is not None:
            usable.append(row)

    if not usable:
        return None

    predicted = bundle["rf"].predict(_matrix(usable))
    acc = float(accuracy_score(_labels(usable), predicted))
    print(f"Akurasi data lapangan: {acc:.4f}")
    return acc


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=DEFAULT_CSV)
    parser.add_argument("--out", type=Path, default=DEFAULT_MODEL)
    args = parser.parse_args()

    cfg = load_config()
    if not args.data.is_file():
        write_csv(generate_samples(5000, DEFAULT_SEED, cfg), args.data)

    rows = read_csv(args.data)
    bundle = train_bundle(rows, cfg)

    real_acc = evaluate_real_field(bundle)
    if real_acc is not None:
        bundle["meta"]["metrics"]["real_field_accuracy"] = real_acc

    args.out.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, args.out, compress=("xz", 3))

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    report = json.dumps(bundle["meta"], indent=2, ensure_ascii=False)
    (ARTIFACT_DIR / "training_report.json").write_text(report, encoding="utf-8")
    importances = json.dumps(bundle["meta"]["feature_importances"], indent=2)
    (ARTIFACT_DIR / "feature_importances.json").write_text(importances, encoding="utf-8")

    print(f"Model disimpan: {args.out}")

if __name__ == "__main__":
    main()