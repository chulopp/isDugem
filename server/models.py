from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, Mapping, Optional


class PayloadError(ValueError):
    """Payload MQTT tidak sesuai kontrak."""


class Status:
    SEDANG_KULIAH = "SEDANG_KULIAH"
    ALERT_BOLOS_KULIAH = "ALERT_BOLOS_KULIAH"
    WARNING_BELUM_KE_MASJID = "WARNING_BELUM_KE_MASJID"
    ISTIRAHAT_DI_KOS = "ISTIRAHAT_DI_KOS"
    CRITICAL_TERDETEKSI_DI_BAR = "CRITICAL_TERDETEKSI_DI_BAR"
    ANOMALY_FAKE_GPS = "ANOMALY_FAKE_GPS"
    NORMAL = "NORMAL"


ALL_STATUSES = (
    Status.SEDANG_KULIAH,
    Status.ALERT_BOLOS_KULIAH,
    Status.WARNING_BELUM_KE_MASJID,
    Status.ISTIRAHAT_DI_KOS,
    Status.CRITICAL_TERDETEKSI_DI_BAR,
    Status.ANOMALY_FAKE_GPS,
    Status.NORMAL,
)

def _mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise PayloadError(f"{name} harus berupa object JSON, dapat: {type(value).__name__}")
    return value


def parseLocation(data: Mapping[str, Any]) -> tuple:
    loc = _mapping(data.get("location"), "location")
    lat = float(loc.get("lat"))
    lon = float(loc.get("lon"))
    if not (-90.0 <= lat <= 90.0):
        raise PayloadError(f"location.lat di luar rentang [-90, 90]: {lat}")
    if not (-180.0 <= lon <= 180.0):
        raise PayloadError(f"location.lon di luar rentang [-180, 180]: {lon}")
    return loc, lat, lon


def _optional_number(container: Mapping[str, Any], key: str, name: str, default: float) -> float:
    if key not in container or container[key] is None:
        return default
    return float(container[key])

def _sent_at_ms(data: Mapping[str, Any]) -> Optional[int]:
    raw = data.get("sent_at_ms")
    if math.isfinite(float(raw)) and float(raw) > 0:
        return int(raw)
    return None

def _check_device(data: Mapping[str, Any], expected: str) -> None:
    device_id = data.get("device_id")
    if device_id is not None and device_id != expected:
        raise PayloadError(f"device_id harus {expected!r}, dapat: {device_id!r}")

@dataclass
class AnakTelemetry:
    sequence: int
    sent_at_ms: Optional[int]
    lat: float
    lon: float
    accuracy_m: float
    rms: Optional[float]
    db: Optional[float]
    accel_magnitude: float
    device_id: str = "anak"

    @classmethod
    def from_payload(cls, data: Any) -> "AnakTelemetry":
        data = _mapping(data, "payload")
        _check_device(data, "anak")
        loc, lat, lon = parseLocation(data)

        audio = _mapping(data.get("audio"), "audio")
        rms_value = audio.get("rms")
        db_value = audio.get("db")
        if rms_value is None and db_value is None:
            raise PayloadError("audio harus memuat minimal salah satu dari 'rms' atau 'db'")
        rms_num = float(rms_value) if rms_value is not None else None
        if rms_num is not None and rms_num < 0:
            raise PayloadError(f"audio.rms tidak boleh negatif: {rms_num}")
        db_num = float(db_value) if db_value is not None else None

        motion = data.get("motion")
        accel = 0.0
        if motion is not None:
            accel = _optional_number(
                _mapping(motion, "motion"), "accel_magnitude", "motion.accel_magnitude", 0.0
            )

        return cls(
            sequence= int(data),
            sent_at_ms=_sent_at_ms(data),
            lat=lat,
            lon=lon,
            accuracy_m=_optional_number(loc, "accuracy_m", "location.accuracy_m", 0.0),
            rms=rms_num,
            db=db_num,
            accel_magnitude=accel,
        )


@dataclass
class OrtuTelemetry:
    sequence: int
    sent_at_ms: Optional[int]
    lat: float
    lon: float
    accel_magnitude: float
    shake_detected: bool
    device_id: str = "ortu"

    @classmethod
    def from_payload(cls, data: Any) -> "OrtuTelemetry":
        data = _mapping(data, "payload")
        _check_device(data, "ortu")
        _, lat, lon = parseLocation(data)

        motion = data.get("motion")
        accel = 0.0
        shake = False
        if motion is not None:
            motion = _mapping(motion, "motion")
            accel = _optional_number(motion, "accel_magnitude", "motion.accel_magnitude", 0.0)
            raw_shake = motion.get("shake_detected", False)
            if not isinstance(raw_shake, bool):
                raise PayloadError(
                    f"motion.shake_detected harus boolean, dapat: {raw_shake!r}"
                )
            shake = raw_shake

        return cls(
            sequence= int(data),
            sent_at_ms=_sent_at_ms(data),
            lat=lat,
            lon=lon,
            accel_magnitude=accel,
            shake_detected=shake,
        )

@dataclass
class AlertContext:
    time_label: str
    nearest_poi: str
    distance_m: float
    db: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "time_label": self.time_label,
            "nearest_poi": self.nearest_poi,
            "distance_m": round(float(self.distance_m), 1),
            "db": round(float(self.db), 1),
        }


@dataclass
class Alert:
    status: str
    reason: str
    timestamp_ms: int
    context: AlertContext

    def __post_init__(self) -> None:
        if self.status not in ALL_STATUSES:
            raise ValueError(f"status tidak ada di enum kontrak: {self.status!r}")

    def to_payload(self) -> Dict[str, Any]:
        return {
            "status": self.status,
            "reason": self.reason,
            "timestamp_ms": int(self.timestamp_ms),
            "context": self.context.to_dict(),
        }