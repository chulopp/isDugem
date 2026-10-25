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
    "kampus": "-6.9915,110.4210,150",
    "masjid": "-6.9930,110.4195,100",
    "kos": "-6.9940,110.4225,50",
    "bar": "-6.9960,110.4240,100",
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

    project_id = os.getenv("PROJECT_ID", "isdugem_tim_01")

    qos = os.getenv("MQTT_QOS", 1)
    if qos not in (0, 1, 2):
        raise ConfigError(f"MQTT_QOS harus 0, 1, atau 2, dapat: {qos}")

    tz_name = os.getenv("TIMEZONE", "Asia/Jakarta")
    try:
        ZoneInfo(tz_name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ConfigError(
            f"TIMEZONE {tz_name!r} tidak ditemukan."
        ) from exc

    poi = {
        name: parsePOI(name, os.getenv(f"POI_{name.upper()}", DEFAULT_POI[name]))
        for name in POI_NAMES
    }

    heartbeat = os.getenv("ALERT_HEARTBEAT_S", 0.0)
    if heartbeat < 0:
        raise ConfigError("ALERT_HEARTBEAT_S tidak boleh negatif")

    return Config(
        project_id = project_id,
        mqtt_host = os.getenv("MQTT_HOST", "broker.hivemq.com"),
        mqtt_port = os.getenv("MQTT_PORT", 8883),
        mqtt_use_tls = os.getenv("MQTT_USE_TLS", True),
        mqtt_username = os.getenv("MQTT_USERNAME") or None,
        mqtt_password = os.getenv("MQTT_PASSWORD") or None,
        mqtt_keepalive = os.getenv("MQTT_KEEPALIVE", 60),
        mqtt_qos = qos,
        timezone = tz_name,
        use_server_clock = os.getenv("USE_SERVER_CLOCK", False),
        kuliah_window = parseTime(os.getenv("KULIAH_WINDOW", "08:00-15:00")),
        sholat_windows = parseTime(os.getenv("SHOLAT_WINDOWS", "12:00-12:45")),
        malam_window = parseTime(os.getenv("MALAM_WINDOW", "22:00-05:00")),
        poi = poi,
        alert_heartbeat_s = heartbeat,
        ping_republish = os.getenv("PING_REPUBLISH", True),
        log_level = os.getenv("LOG_LEVEL", "INFO").upper(),
    )
