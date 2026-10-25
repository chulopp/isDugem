"""
Data models and dataclasses for RantauGuard server processing.
Matches exact schema defined in docs/mqtt-schema.md.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Dict, Any

class AlertStatus(str, Enum):
    SEDANG_KULIAH = "SEDANG_KULIAH"
    ALERT_BOLOS_KULIAH = "ALERT_BOLOS_KULIAH"
    WARNING_BELUM_KE_MASJID = "WARNING_BELUM_KE_MASJID"
    ISTIRAHAT_DI_KOS = "ISTIRAHAT_DI_KOS"
    CRITICAL_TERDETEKSI_DI_BAR = "CRITICAL_TERDETEKSI_DI_BAR"
    ANOMALY_FAKE_GPS = "ANOMALY_FAKE_GPS"
    NORMAL = "NORMAL"


@dataclass
class Location:
    lat: float
    lon: float
    accuracy_m: float = 0.0


@dataclass
class Audio:
    rms: float
    db: float


@dataclass
class Motion:
    accel_magnitude: float
    shake_detected: bool = False


@dataclass
class AnakTelemetry:
    device_id: str
    sequence: int
    sent_at_ms: int
    location: Location
    audio: Audio
    motion: Motion


@dataclass
class OrtuTelemetry:
    device_id: str
    sequence: int
    sent_at_ms: int
    location: Location
    motion: Motion


@dataclass
class Context:
    time_label: str  # "jam_kuliah" | "waktu_sholat" | "jam_malam" | "lainnya"
    distance_kampus_m: float
    distance_masjid_m: float
    distance_kos_m: float
    distance_bar_m: float
    db_level: float
    claimed_at_kos: bool  # True jika koordinat berada di dalam radius kos


@dataclass
class AlertContext:
    time_label: str
    nearest_poi: str
    distance_m: float
    db: float


@dataclass
class Alert:
    status: AlertStatus
    reason: str
    timestamp_ms: int
    context: AlertContext

    def to_dict(self) -> Dict[str, Any]:
        return {
            "status": self.status.value,
            "reason": self.reason,
            "timestamp_ms": self.timestamp_ms,
            "context": {
                "time_label": self.context.time_label,
                "nearest_poi": self.context.nearest_poi,
                "distance_m": round(self.context.distance_m, 1),
                "db": round(self.context.db, 1),
            },
        }
