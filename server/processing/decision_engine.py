from __future__ import annotations
from dataclasses import dataclass
from datetime import time
from typing import Dict, Mapping, Optional, Sequence, Tuple
from config import POI, rangeTime
from models import Status
from processing.haversine import haversine_distance_m

JAM_KULIAH = "jam_kuliah"
WAKTU_SHOLAT = "waktu_sholat"
JAM_MALAM = "jam_malam"
LAINNYA = "lainnya"

DEFAULT_RADII_M: Dict[str, float] = {
    "kampus": 150.0,
    "masjid": 100.0,
    "kos": 50.0,
    "bar": 100.0,
}

DB_KULIAH_TENANG_MAX = 65.0   
DB_KOS_TENANG_MAX = 55.0      
DB_BAR_MIN = 75.0             
DB_ANOMALY_MIN = 80.0         

@dataclass
class Context:
    time_label: str     
    distance_kampus_m: float
    distance_masjid_m: float
    distance_kos_m: float
    distance_bar_m: float
    db_level: float
    claimed_at_kos: bool  

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