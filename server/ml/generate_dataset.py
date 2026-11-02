"""Generator dataset sintetis isDugem (physics-informed, Gaussian noise, cyclical time).

Jalankan dari folder server/:
    python -m ml.generate_dataset                 # 5.000 sampel -> ml/data/synthetic_dataset.csv
    python -m ml.generate_dataset --n 5000 --seed 42

Prinsip (PRD 15.2):
  * Posisi disampel di sekitar POI nyata (config.py), lalu jarak dihitung dengan
    haversine yang sama dengan server -> fitur jarak konsisten secara geometri.
  * Fitur = nilai SETELAH Gaussian noise (yang benar-benar diterima server):
        jitter GPS  sigma 5-15 m (per sampel, tiap sumbu),
        fluktuasi dB sigma 3-6 dB, derau kecepatan sigma 0.2-0.5 m/s.
  * Label (ground truth) = keluaran classify() rule-based yang SUDAH ADA pada fitur
    teramati tersebut. Alasan: jika label diambil dari nilai bersih, noise di dekat
    ambang (mis. 65/55/75/80 dB) membuat label tak bisa ditebak dari fitur, dan batas
    atas akurasi hanya ~95,6% (rule-based sendiri pun segitu). Dengan protokol ini,
    "agreement rate" berarti: seberapa setia ML meniru mesin keputusan yang disepakati
    pada input yang sama, sehingga ML dan fallback rule-based saling dapat menggantikan.
  * Noise bertindak sebagai augmentasi/regularisasi: model dilatih pada distribusi
    sensor yang tidak sempurna, bukan pada nilai ideal.
  * Waktu di-encode siklikal: time_sin/time_cos = sin/cos(2*pi*menit/1440).
"""
from __future__ import annotations

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

from config import Config, load_config  # noqa: E402
from models import ALL_STATUSES, Status  # noqa: E402
from processing.audio_rms import DB_MAX, DB_MIN  # noqa: E402
from processing.decision_engine import (  # noqa: E402
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

DEFAULT_N = 5000
DEFAULT_SEED = 42
DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_CSV = DATA_DIR / "synthetic_dataset.csv"
CSV_COLUMNS: Tuple[str, ...] = FEATURE_NAMES + ("label", "time_label")

# Rentang noise (PRD 15.2 poin 3)
GPS_SIGMA_RANGE = (5.0, 15.0)
DB_SIGMA_RANGE = (3.0, 6.0)
SPEED_SIGMA_RANGE = (0.2, 0.5)

BACKGROUND_FRACTION = 0.40      # porsi sampel "hari biasa": menit seragam 24 jam, lokasi & dB acak
BOUNDARY_TIME_FRACTION = 0.25   # porsi sampel waktu dekat tepi jendela (hard examples)
BOUNDARY_MARGIN_MIN = 8
METERS_PER_DEG_LAT = 111_320.0

# Skenario kelas dibagi rata (PRD 15.2 poin 2: mitigasi class imbalance).
CLASS_ORDER: Tuple[str, ...] = tuple(ALL_STATUSES)


def _offset_latlon(lat: float, lon: float, east_m: float, north_m: float) -> Tuple[float, float]:
    dlat = north_m / METERS_PER_DEG_LAT
    dlon = east_m / (METERS_PER_DEG_LAT * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


class _Sampler:
    def __init__(self, cfg: Config, rng: random.Random) -> None:
        self.cfg = cfg
        self.rng = rng
        self.minutes_by_label: Dict[str, List[int]] = {
            JAM_KULIAH: [], WAKTU_SHOLAT: [], JAM_MALAM: [], LAINNYA: [],
        }
        self.label_of_minute: List[str] = []
        for m in range(1440):
            label = get_time_label(
                dtime(m // 60, m % 60), cfg.kuliah_window, cfg.sholat_windows, cfg.malam_window
            )
            self.label_of_minute.append(label)
            self.minutes_by_label[label].append(m)
        self.boundary_minutes: Dict[str, List[int]] = {
            label: [m for m in minutes if self._near_edge(m)]
            for label, minutes in self.minutes_by_label.items()
        }

    def _near_edge(self, minute: int) -> bool:
        here = self.label_of_minute[minute]
        return any(
            self.label_of_minute[(minute + d) % 1440] != here
            for d in range(-BOUNDARY_MARGIN_MIN, BOUNDARY_MARGIN_MIN + 1)
        )

    def minute(self, label: str) -> float:
        pool = self.minutes_by_label[label]
        edge = self.boundary_minutes[label]
        if edge and self.rng.random() < BOUNDARY_TIME_FRACTION:
            pool = edge
        return self.rng.choice(pool) + self.rng.random()  # pecahan = detik di dalam menit

    def near(self, poi: str, r_min: float, r_max: float) -> Tuple[float, float]:
        p = self.cfg.poi[poi]
        r = self.rng.uniform(r_min, r_max)
        theta = self.rng.uniform(0.0, 2.0 * math.pi)
        return _offset_latlon(p.lat, p.lon, r * math.sin(theta), r * math.cos(theta))

    def anywhere_far_from(self, poi_names: Sequence[str], min_m: float) -> Tuple[float, float]:
        """Titik acak 0.3-6 km dari salah satu POI, ditolak jika terlalu dekat POI terlarang."""
        from processing.haversine import haversine_distance_m

        for _ in range(200):
            lat, lon = self.near(self.rng.choice(("kampus", "masjid", "kos", "bar")), 300.0, 6000.0)
            if all(
                haversine_distance_m(lat, lon, self.cfg.poi[n].lat, self.cfg.poi[n].lon) > min_m
                for n in poi_names
            ):
                return lat, lon
        return self.near("kampus", 3000.0, 6000.0)

    def speed(self, moving_probability: float) -> float:
        if self.rng.random() < moving_probability:
            if self.rng.random() < 0.5:
                return self.rng.uniform(0.8, 2.2)    # jalan kaki
            return self.rng.uniform(7.0, 13.0)       # motor / angkot
        return abs(self.rng.gauss(0.0, 0.3))         # diam (drift GPS)


def _scenario(cls: str, s: _Sampler) -> Tuple[str, float, Tuple[float, float], float, float]:
    """Return (time_label, minute, (lat, lon), db_bersih, kecepatan_bersih) untuk kelas target."""
    rng = s.rng
    cfg = s.cfg
    rk, rm, rko, rb = (cfg.poi[n].radius_m for n in ("kampus", "masjid", "kos", "bar"))

    if cls == Status.SEDANG_KULIAH:
        return JAM_KULIAH, s.minute(JAM_KULIAH), s.near("kampus", 0, rk), rng.uniform(28, 65), s.speed(0.05)

    if cls == Status.ALERT_BOLOS_KULIAH:
        pos = rng.choice([
            lambda: s.near("kos", 0, rko),
            lambda: s.near("bar", 0, 400),
            lambda: s.near("masjid", 0, 400),
            lambda: s.near("kampus", rk + 5, 3000),
            lambda: s.anywhere_far_from(("kampus",), rk + 5),
        ])()
        return JAM_KULIAH, s.minute(JAM_KULIAH), pos, rng.uniform(25, 100), s.speed(0.5)

    if cls == Status.WARNING_BELUM_KE_MASJID:
        pos = rng.choice([
            lambda: s.near("kampus", 0, 400),
            lambda: s.near("kos", 0, rko),
            lambda: s.near("bar", 0, 400),
            lambda: s.near("masjid", rm + 5, 3000),
            lambda: s.anywhere_far_from(("masjid",), rm + 5),
        ])()
        return WAKTU_SHOLAT, s.minute(WAKTU_SHOLAT), pos, rng.uniform(25, 95), s.speed(0.4)

    if cls == Status.ISTIRAHAT_DI_KOS:
        return JAM_MALAM, s.minute(JAM_MALAM), s.near("kos", 0, rko), rng.uniform(35, 58), s.speed(0.03)

    if cls == Status.CRITICAL_TERDETEKSI_DI_BAR:
        return JAM_MALAM, s.minute(JAM_MALAM), s.near("bar", 0, rb), rng.uniform(75, 110), s.speed(0.15)

    if cls == Status.ANOMALY_FAKE_GPS:
        # koordinat "terkunci" di kos (mock location statis) tetapi suara seperti konser
        if rng.random() < 0.5:
            return JAM_MALAM, s.minute(JAM_MALAM), s.near("kos", 0, rko), rng.uniform(80, 115), s.speed(0.02)
        else:
            return JAM_MALAM, s.minute(JAM_MALAM), s.near("kos", 0, rko), rng.uniform(80, 115), s.speed(0.9)

    # NORMAL: enam sub-skenario berbobot sama
    sub = rng.randrange(6)
    if sub == 0:   # kuliah di kampus tetapi ramai (dB >= 65)
        return JAM_KULIAH, s.minute(JAM_KULIAH), s.near("kampus", 0, rk), rng.uniform(65, 100), s.speed(0.1)
    if sub == 1:   # sholat di masjid
        return WAKTU_SHOLAT, s.minute(WAKTU_SHOLAT), s.near("masjid", 0, rm), rng.uniform(30, 90), s.speed(0.1)
    if sub == 2:   # malam di kos, dB 55-80 (bukan tenang, bukan anomali)
        return JAM_MALAM, s.minute(JAM_MALAM), s.near("kos", 0, rko), rng.uniform(55, 80), s.speed(0.05)
    if sub == 3:   # malam di sekitar bar tetapi tidak cukup keras
        return JAM_MALAM, s.minute(JAM_MALAM), s.near("bar", 0, rb), rng.uniform(30, 75), s.speed(0.3)
    if sub == 4:   # malam di tempat lain (bukan kos, bukan bar)
        return JAM_MALAM, s.minute(JAM_MALAM), s.anywhere_far_from(("kos", "bar"), max(rko, rb) + 5), rng.uniform(30, 110), s.speed(0.5)
    # sub == 5: waktu "lainnya" (di luar kuliah/sholat/malam): di mana saja
    pos = rng.choice([
        lambda: s.near("kampus", 0, 3000),
        lambda: s.near("kos", 0, 1500),
        lambda: s.near("bar", 0, 1500),
        lambda: s.near("masjid", 0, 1500),
    ])()
    return LAINNYA, s.minute(LAINNYA), pos, rng.uniform(25, 105), s.speed(0.5)


def _background(s: _Sampler) -> Tuple[str, float, Tuple[float, float], float, float]:
    """Sampel "hari biasa": menit seragam 0-1440 + lokasi/dB acak. Label murni dari rule engine.

    Memberi cakupan waktu penuh (termasuk jam 'lainnya' di antara jendela kuliah/sholat/malam)
    sehingga model belajar batas waktu dari seluruh lingkaran 24 jam, bukan hanya dekat jendela.
    """
    rng = s.rng
    minute = rng.uniform(0.0, 1440.0)
    label_time = s.label_of_minute[int(minute)]
    pos = rng.choice([
        lambda: s.near("kampus", 0, 400),
        lambda: s.near("masjid", 0, 300),
        lambda: s.near("kos", 0, 1000),
        lambda: s.near("bar", 0, 400),
        lambda: s.anywhere_far_from(("kampus", "masjid", "kos", "bar"), 300.0),
    ])()
    return label_time, minute, pos, rng.uniform(25, 110), s.speed(0.4)


def generate_samples(
    n: int = DEFAULT_N,
    seed: int = DEFAULT_SEED,
    cfg: Optional[Config] = None,
) -> List[Dict[str, Any]]:
    """Buat n sampel: skenario kelas seimbang + sampel latar 24 jam. Deterministik per seed."""
    cfg = cfg or load_config()
    rng = random.Random(seed)
    sampler = _Sampler(cfg, rng)
    radii = cfg.radii_m
    rows: List[Dict[str, Any]] = []

    for i in range(n):
        target = CLASS_ORDER[i % len(CLASS_ORDER)]   # kelas yang diskenariokan (proporsi dasar seimbang)
        if rng.random() < BACKGROUND_FRACTION:
            label_time, minute, (lat, lon), db_clean, speed_clean = _background(sampler)
        else:
            label_time, minute, (lat, lon), db_clean, speed_clean = _scenario(target, sampler)

        # Gaussian noise: jitter GPS (m) -> geser koordinat -> jarak dihitung ulang
        gps_sigma = rng.uniform(*GPS_SIGMA_RANGE)
        n_lat, n_lon = _offset_latlon(lat, lon, rng.gauss(0, gps_sigma), rng.gauss(0, gps_sigma))
        db_noisy = max(DB_MIN, min(DB_MAX, db_clean + rng.gauss(0.0, rng.uniform(*DB_SIGMA_RANGE))))
        speed_noisy = max(0.0, speed_clean + rng.gauss(0.0, rng.uniform(*SPEED_SIGMA_RANGE)))

        observed_ctx = build_context(n_lat, n_lon, db_noisy, label_time, cfg.poi)
        vec = build_feature_vector(observed_ctx, minute, speed_noisy)
        row: Dict[str, Any] = dict(zip(FEATURE_NAMES, vec))
        row["label"] = classify(observed_ctx, radii)   # ground truth = rule engine pada fitur teramati
        row["time_label"] = label_time
        rows.append(row)

    rng.shuffle(rows)
    return rows


def write_csv(rows: Sequence[Dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: (f"{v:.6f}" if isinstance(v, float) else v) for k, v in row.items()})


def read_csv(path: Path) -> List[Dict[str, Any]]:
    with Path(path).open(newline="", encoding="utf-8") as fh:
        return [
            {**{k: float(r[k]) for k in FEATURE_NAMES}, "label": r["label"], "time_label": r["time_label"]}
            for r in csv.DictReader(fh)
        ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Generator dataset sintetis isDugem")
    parser.add_argument("--n", type=int, default=DEFAULT_N, help="jumlah sampel (default 5000)")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--out", type=Path, default=DEFAULT_CSV)
    args = parser.parse_args()

    rows = generate_samples(args.n, args.seed)
    write_csv(rows, args.out)

    counts: Dict[str, int] = {}
    for r in rows:
        counts[r["label"]] = counts.get(r["label"], 0) + 1
    print(f"[OK] {len(rows)} sampel -> {args.out}")
    for label in CLASS_ORDER:
        print(f"  {label:<28} {counts.get(label, 0):>5}")


if __name__ == "__main__":
    main()