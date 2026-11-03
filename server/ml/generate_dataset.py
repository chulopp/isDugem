import argparse
import csv
import math
import random
import sys
from datetime import time as dtime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

SERVER_DIR = Path(__file__).resolve().parent.parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from config import Config, load_config
from models import ALL_STATUSES, Status
from processing.audio_rms import DB_MAX, DB_MIN
from processing.decision_engine import (
    FEATURE_NAMES,
    JAM_KULIAH,
    JAM_MALAM,
    LAINNYA,
    WAKTU_SHOLAT,
    build_context,
    build_feature_vector,
    classify,
    get_time_label,
)
from processing.haversine import haversine_distance_m

DEFAULT_N = 5000
DEFAULT_SEED = 42
DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_CSV = DATA_DIR / "synthetic_dataset.csv"
CSV_COLUMNS: Tuple[str, ...] = FEATURE_NAMES + ("label", "time_label")

GPS_SIGMA_RANGE = (5.0, 15.0)
DB_SIGMA_RANGE = (3.0, 6.0)
SPEED_SIGMA_RANGE = (0.2, 0.5)

BACKGROUND_FRACTION = 0.40
BOUNDARY_TIME_FRACTION = 0.25
BOUNDARY_MARGIN_MIN = 8
METERS_PER_DEG_LAT = 111_320.0

CLASS_ORDER: Tuple[str, ...] = tuple(ALL_STATUSES)

Scenario = Tuple[str, float, Tuple[float, float], float, float]

def _offset_latlon(lat: float, lon: float, east_m: float, north_m: float) -> Tuple[float, float]:
    new_lat = lat + north_m / METERS_PER_DEG_LAT
    new_lon = lon + east_m / (METERS_PER_DEG_LAT * math.cos(math.radians(lat)))
    return new_lat, new_lon

class _Sampler:
    def __init__(self, cfg: Config, rng: random.Random) -> None:
        self.cfg = cfg
        self.rng = rng

        self.label_of_minute: List[str] = []
        self.minutes_by_label: Dict[str, List[int]] = {
            JAM_KULIAH: [], WAKTU_SHOLAT: [], JAM_MALAM: [], LAINNYA: [],
        }
        for minute in range(1440):
            clock = dtime(minute // 60, minute % 60)
            label = get_time_label(clock, cfg.kuliah_window, cfg.sholat_windows, cfg.malam_window)
            self.label_of_minute.append(label)
            self.minutes_by_label[label].append(minute)

        self.boundary_minutes: Dict[str, List[int]] = {}
        for label, minutes in self.minutes_by_label.items():
            self.boundary_minutes[label] = [m for m in minutes if self._near_edge(m)]

    def _near_edge(self, minute: int) -> bool:
        here = self.label_of_minute[minute]
        for delta in range(-BOUNDARY_MARGIN_MIN, BOUNDARY_MARGIN_MIN + 1):
            if self.label_of_minute[(minute + delta) % 1440] != here:
                return True
        return False

    def minute(self, label: str) -> float:
        pool = self.minutes_by_label[label]
        edge_pool = self.boundary_minutes[label]
        if edge_pool and self.rng.random() < BOUNDARY_TIME_FRACTION:
            pool = edge_pool
        return self.rng.choice(pool) + self.rng.random()

    def near(self, poi: str, r_min: float, r_max: float) -> Tuple[float, float]:
        p = self.cfg.poi[poi]
        radius = self.rng.uniform(r_min, r_max)
        angle = self.rng.uniform(0.0, 2.0 * math.pi)
        return _offset_latlon(p.lat, p.lon, radius * math.sin(angle), radius * math.cos(angle))

    def anywhere_far_from(self, poi_names: Sequence[str], min_m: float) -> Tuple[float, float]:
        for _ in range(200):
            anchor = self.rng.choice(("kampus", "masjid", "kos", "bar"))
            lat, lon = self.near(anchor, 300.0, 6000.0)
            far_enough = True
            for name in poi_names:
                poi = self.cfg.poi[name]
                if haversine_distance_m(lat, lon, poi.lat, poi.lon) <= min_m:
                    far_enough = False
                    break
            if far_enough:
                return lat, lon
        return self.near("kampus", 3000.0, 6000.0)

    def spot(self, options: Sequence[tuple]) -> Tuple[float, float]:
        option = self.rng.choice(options)
        if option[0] == "jauh":
            return self.anywhere_far_from(option[1], option[2])
        return self.near(*option)

    def speed(self, moving_probability: float) -> float:
        if self.rng.random() < moving_probability:
            if self.rng.random() < 0.5:
                return self.rng.uniform(0.8, 2.2)
            return self.rng.uniform(7.0, 13.0)
        return abs(self.rng.gauss(0.0, 0.3))

def _scenario(target: str, s: _Sampler) -> Scenario:
    rng, cfg = s.rng, s.cfg
    r_kampus, r_masjid, r_kos, r_bar = (cfg.poi[n].radius_m for n in ("kampus", "masjid", "kos", "bar"))

    if target == Status.SEDANG_KULIAH:
        minute = s.minute(JAM_KULIAH)
        pos = s.near("kampus", 0, r_kampus)
        return JAM_KULIAH, minute, pos, rng.uniform(28, 65), s.speed(0.05)

    if target == Status.ALERT_BOLOS_KULIAH:
        pos = s.spot([
            ("kos", 0, r_kos),
            ("bar", 0, 400),
            ("masjid", 0, 400),
            ("kampus", r_kampus + 5, 3000),
            ("jauh", ["kampus"], r_kampus + 5),
        ])
        minute = s.minute(JAM_KULIAH)
        return JAM_KULIAH, minute, pos, rng.uniform(25, 100), s.speed(0.5)

    if target == Status.WARNING_BELUM_KE_MASJID:
        pos = s.spot([
            ("kampus", 0, 400),
            ("kos", 0, r_kos),
            ("bar", 0, 400),
            ("masjid", r_masjid + 5, 3000),
            ("jauh", ["masjid"], r_masjid + 5),
        ])
        minute = s.minute(WAKTU_SHOLAT)
        return WAKTU_SHOLAT, minute, pos, rng.uniform(25, 95), s.speed(0.4)

    if target == Status.ISTIRAHAT_DI_KOS:
        minute = s.minute(JAM_MALAM)
        pos = s.near("kos", 0, r_kos)
        return JAM_MALAM, minute, pos, rng.uniform(35, 58), s.speed(0.03)

    if target == Status.CRITICAL_TERDETEKSI_DI_BAR:
        minute = s.minute(JAM_MALAM)
        pos = s.near("bar", 0, r_bar)
        return JAM_MALAM, minute, pos, rng.uniform(75, 110), s.speed(0.15)

    if target == Status.ANOMALY_FAKE_GPS:
        moving_probability = 0.02 if rng.random() < 0.5 else 0.9
        minute = s.minute(JAM_MALAM)
        pos = s.near("kos", 0, r_kos)
        return JAM_MALAM, minute, pos, rng.uniform(80, 115), s.speed(moving_probability)

    kind = rng.randrange(6)
    if kind == 0:
        minute = s.minute(JAM_KULIAH)
        pos = s.near("kampus", 0, r_kampus)
        return JAM_KULIAH, minute, pos, rng.uniform(65, 100), s.speed(0.1)
    if kind == 1:
        minute = s.minute(WAKTU_SHOLAT)
        pos = s.near("masjid", 0, r_masjid)
        return WAKTU_SHOLAT, minute, pos, rng.uniform(30, 90), s.speed(0.1)
    if kind == 2:
        minute = s.minute(JAM_MALAM)
        pos = s.near("kos", 0, r_kos)
        return JAM_MALAM, minute, pos, rng.uniform(55, 80), s.speed(0.05)
    if kind == 3:
        minute = s.minute(JAM_MALAM)
        pos = s.near("bar", 0, r_bar)
        return JAM_MALAM, minute, pos, rng.uniform(30, 75), s.speed(0.3)
    if kind == 4:
        minute = s.minute(JAM_MALAM)
        pos = s.anywhere_far_from(["kos", "bar"], max(r_kos, r_bar) + 5)
        return JAM_MALAM, minute, pos, rng.uniform(30, 110), s.speed(0.5)

    pos = s.spot([
        ("kampus", 0, 3000),
        ("kos", 0, 1500),
        ("bar", 0, 1500),
        ("masjid", 0, 1500),
    ])
    minute = s.minute(LAINNYA)
    return LAINNYA, minute, pos, rng.uniform(25, 105), s.speed(0.5)

def _background(s: _Sampler) -> Scenario:
    rng = s.rng
    minute = rng.uniform(0.0, 1440.0)
    label_time = s.label_of_minute[int(minute)]
    pos = s.spot([
        ("kampus", 0, 400),
        ("masjid", 0, 300),
        ("kos", 0, 1000),
        ("bar", 0, 400),
        ("jauh", ["kampus", "masjid", "kos", "bar"], 300.0),
    ])
    return label_time, minute, pos, rng.uniform(25, 110), s.speed(0.4)

def generate_samples(
    n: int = DEFAULT_N,
    seed: int = DEFAULT_SEED,
    cfg: Optional[Config] = None,
) -> List[Dict[str, Any]]:
    cfg = cfg or load_config()
    rng = random.Random(seed)
    sampler = _Sampler(cfg, rng)
    radii = cfg.radii_m
    rows: List[Dict[str, Any]] = []

    for i in range(n):
        target = CLASS_ORDER[i % len(CLASS_ORDER)]

        if rng.random() < BACKGROUND_FRACTION:
            scenario = _background(sampler)
        else:
            scenario = _scenario(target, sampler)
        label_time, minute, (lat, lon), db_clean, speed_clean = scenario

        gps_sigma = rng.uniform(*GPS_SIGMA_RANGE)
        noisy_lat, noisy_lon = _offset_latlon(lat, lon, rng.gauss(0, gps_sigma), rng.gauss(0, gps_sigma))
        db_noise = rng.gauss(0.0, rng.uniform(*DB_SIGMA_RANGE))
        db_noisy = max(DB_MIN, min(DB_MAX, db_clean + db_noise))
        speed_noise = rng.gauss(0.0, rng.uniform(*SPEED_SIGMA_RANGE))
        speed_noisy = max(0.0, speed_clean + speed_noise)

        observed = build_context(noisy_lat, noisy_lon, db_noisy, label_time, cfg.poi)
        features = build_feature_vector(observed, minute, speed_noisy)
        row: Dict[str, Any] = dict(zip(FEATURE_NAMES, features))
        row["label"] = classify(observed, radii)
        row["time_label"] = label_time
        rows.append(row)

    rng.shuffle(rows)
    return rows

def write_csv(rows: Sequence[Dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=CSV_COLUMNS, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: (f"{v:.6f}" if isinstance(v, float) else v) for k, v in row.items()})

def read_csv(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with Path(path).open(newline="", encoding="utf-8") as file:
        for record in csv.DictReader(file):
            row: Dict[str, Any] = {name: float(record[name]) for name in FEATURE_NAMES}
            row["label"] = record["label"]
            row["time_label"] = record["time_label"]
            rows.append(row)
    return rows

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n", type=int, default=DEFAULT_N)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--out", type=Path, default=DEFAULT_CSV)
    args = parser.parse_args()

    rows = generate_samples(args.n, args.seed)
    write_csv(rows, args.out)
    print(f"{len(rows)} sampel dibuat -> {args.out}")

if __name__ == "__main__":
    main()