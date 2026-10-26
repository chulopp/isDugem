from __future__ import annotations

import math
import os
import re
from dataclasses import dataclass
from datetime import time
from pathlib import Path
from typing import Dict, Mapping, Optional, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from dotenv import load_dotenv

POI_NAMES: Tuple[str, ...] = ("kampus", "masjid", "kos", "bar")

DEFAULT_POI: Dict[str, str] = {
    "kampus": "-7.0502,110.4398,150",
    "masjid": "-7.0552,110.4370,100",
    "kos": "-7.0632,110.4385,750",
    "bar": "-6.966984,110.429807,250",
}

class ConfigError(ValueError):
    """Untuk Error Condition"""

@dataclass
class POI:
    lat: float
    lon: float
    radius_m: float

@dataclass
class rangeTime:
    start: time
    end: time

    def contains(self, t:time) -> bool:
        t = t.replace(tzinfo=None)
        if self.start <= self.end:
            return self.start <= t < self.end
        return t >= self.start or t < self.end
    
def parseTime(text: str) -> time:
    try:
        hh, mm = text.strip().split(":")
        hour, minute = int(hh), int(mm)
        return time(hour, minute)
    except (ValueError, TypeError) as exc:
        raise ConfigError(f"Format jam harus HH:MM, dapat: {text!r}") from exc

def parseWindow(text: str) -> rangeTime:
    parts = text.strip().split("-")
    if len(parts) != 2:
        raise ConfigError(f"Format waktu harus HH:MM-HH:MM, dapat: {text!r}")
    return rangeTime(parseTime(parts[0]), parseTime(parts[1]))

def parseWindows(text: str) -> Tuple[rangeTime, ...]:
    items = [p for p in (text or "").split(",") if p.strip()]
    return tuple(parseWindow(p) for p in items)

def parsePOI(name: str, text: str) -> POI:
    lat_env = os.getenv(f"{name.upper()}_LAT")
    lon_env = os.getenv(f"{name.upper()}_LON")
    rad_env = os.getenv(f"{name.upper()}_RADIUS_M")
    if lat_env and lon_env and rad_env and not os.getenv(f"POI_{name.upper()}"):
        text = f"{lat_env},{lon_env},{rad_env}"

    parts = [p.strip() for p in text.split(",")]
    if len(parts) != 3:
        raise ConfigError(f"POI_{name.upper()} harus 'lat,lon,radius_m', dapat: {text!r}")
    try:
        lat, lon, radius = (float(p) for p in parts)
    except ValueError as exc:
        raise ConfigError(f"POI_{name.upper()} berisi angka tidak valid: {text!r}") from exc
    if not all(math.isfinite(v) for v in (lat, lon, radius)):
        raise ConfigError(f"POI_{name.upper()} berisi nilai non-finite: {text!r}")
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ConfigError(f"POI_{name.upper()} di luar rentang koordinat: {text!r}")
    if radius <= 0:
        raise ConfigError(f"POI_{name.upper()} radius harus > 0: {text!r}")
    return POI(lat=lat, lon=lon, radius_m=radius)

def _env_bool(key: str, default: bool) -> bool:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    value = raw.strip().lower()
    if value in ("1", "true", "yes", "y", "on"):
        return True
    if value in ("0", "false", "no", "n", "off"):
        return False
    raise ConfigError(f"{key} harus boolean (true/false), dapat: {raw!r}")

def _env_int(key: str, default: int) -> int:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw.strip())
    except ValueError as exc:
        raise ConfigError(f"{key} harus bilangan bulat, dapat: {raw!r}") from exc

def _env_float(key: str, default: float) -> float:
    raw = os.getenv(key)
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw.strip())
    except ValueError as exc:
        raise ConfigError(f"{key} harus angka, dapat: {raw!r}") from exc

def _env_str(key: str, default: str) -> str:
    raw = os.getenv(key)
    return default if raw is None or raw.strip() == "" else raw.strip()

_PROJECT_ID_RE = re.compile(r"^[A-Za-z0-9_\-]+$")

@dataclass
class Config:
    project_id: str
    mqtt_host: str
    mqtt_port: int
    mqtt_use_tls: bool
    mqtt_username: Optional[str]
    mqtt_password: Optional[str]
    mqtt_keepalive: int
    mqtt_qos: int
    timezone: str
    use_server_clock: bool
    kuliah_window: rangeTime
    sholat_windows: Tuple[rangeTime, ...]
    malam_window: rangeTime
    poi: Mapping[str, POI]
    alert_heartbeat_s: float
    ping_republish: bool
    log_level: str

    @property
    def topic_prefix(self) -> str:
        return f"rantauguard/{self.project_id}"

    @property
    def topic_anak_telemetry(self) -> str:
        return f"{self.topic_prefix}/edge/anak/telemetry"

    @property
    def topic_ortu_telemetry(self) -> str:
        return f"{self.topic_prefix}/edge/ortu/telemetry"

    @property
    def topic_alerts(self) -> str:
        return f"{self.topic_prefix}/alerts"

    @property
    def topic_command_ping(self) -> str:
        return f"{self.topic_prefix}/command/ping"

    @property
    def subscribe_topics(self) -> Tuple[str, ...]:
        return (
            self.topic_anak_telemetry,
            self.topic_ortu_telemetry,
            self.topic_command_ping,
        )

    @property
    def radii_m(self) -> Dict[str, float]:
        return {name: poi.radius_m for name, poi in self.poi.items()}


def load_config(env_file: Optional[Path] = None) -> Config:
    env_path = env_file or (Path(__file__).resolve().parent / ".env")
    load_dotenv(env_path, override=False)

    project_id = _env_str("PROJECT_ID", "isdugem_tim_01")
    if not _PROJECT_ID_RE.match(project_id):
        raise ConfigError(
            "PROJECT_ID hanya boleh huruf, angka, '_' dan '-' "
            f"(tanpa '/', '+', '#'), dapat: {project_id!r}"
        )

    qos = _env_int("MQTT_QOS", 1)
    if qos not in (0, 1, 2):
        raise ConfigError(f"MQTT_QOS harus 0, 1, atau 2, dapat: {qos}")

    tz_name = _env_str("TIMEZONE", "Asia/Jakarta")
    try:
        ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ConfigError(
            f"TIMEZONE {tz_name!r} tidak ditemukan. Di Windows jalankan: pip install tzdata"
        ) from exc

    poi = {
        name: parsePOI(name, _env_str(f"POI_{name.upper()}", DEFAULT_POI[name]))
        for name in POI_NAMES
    }

    heartbeat = _env_float("ALERT_HEARTBEAT_S", 0.0)
    if heartbeat < 0:
        raise ConfigError("ALERT_HEARTBEAT_S tidak boleh negatif")

    return Config(
        project_id=project_id,
        mqtt_host=_env_str("MQTT_HOST", "broker.hivemq.com"),
        mqtt_port=_env_int("MQTT_PORT", 8883),
        mqtt_use_tls=_env_bool("MQTT_USE_TLS", True),
        mqtt_username=os.getenv("MQTT_USERNAME") or None,
        mqtt_password=os.getenv("MQTT_PASSWORD") or None,
        mqtt_keepalive=_env_int("MQTT_KEEPALIVE", 60),
        mqtt_qos=qos,
        timezone=tz_name,
        use_server_clock=_env_bool("USE_SERVER_CLOCK", False),
        kuliah_window=parseWindow(_env_str("KULIAH_WINDOW", "08:00-15:00")),
        sholat_windows=parseWindows(_env_str("SHOLAT_WINDOWS", "12:00-12:45,15:15-15:45,18:00-18:30,19:15-19:45")),
        malam_window=parseWindow(_env_str("MALAM_WINDOW", "22:00-05:00")),
        poi=poi,
        alert_heartbeat_s=heartbeat,
        ping_republish=_env_bool("PING_REPUBLISH", True),
        log_level=_env_str("LOG_LEVEL", "INFO").upper(),
    )