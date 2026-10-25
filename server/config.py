"""
Configuration loader for RantauGuard server backend.
"""

import os
from dataclasses import dataclass
from dotenv import load_dotenv

# Muat file .env dari folder server atau root
load_dotenv()


@dataclass(frozen=True)
class POI:
    name: str
    lat: float
    lon: float
    radius_m: float


@dataclass(frozen=True)
class AppConfig:
    project_id: str
    mqtt_host: str
    mqtt_port: int
    mqtt_keepalive: int
    poi_kampus: POI
    poi_masjid: POI
    poi_kos: POI
    poi_bar: POI

    @property
    def topic_anak_telemetry(self) -> str:
        return f"rantauguard/{self.project_id}/edge/anak/telemetry"

    @property
    def topic_ortu_telemetry(self) -> str:
        return f"rantauguard/{self.project_id}/edge/ortu/telemetry"

    @property
    def topic_alerts(self) -> str:
        return f"rantauguard/{self.project_id}/alerts"

    @property
    def topic_command_ping(self) -> str:
        return f"rantauguard/{self.project_id}/command/ping"


def load_config() -> AppConfig:
    project_id = os.getenv("PROJECT_ID", "isdugem_tim_01")
    mqtt_host = os.getenv("MQTT_HOST", "broker.hivemq.com")
    mqtt_port = int(os.getenv("MQTT_PORT", "8883"))
    mqtt_keepalive = int(os.getenv("MQTT_KEEPALIVE", "60"))

    poi_kampus = POI(
        name="kampus",
        lat=float(os.getenv("KAMPUS_LAT", "-6.9915")),
        lon=float(os.getenv("KAMPUS_LON", "110.4210")),
        radius_m=float(os.getenv("KAMPUS_RADIUS_M", "150.0")),
    )
    poi_masjid = POI(
        name="masjid",
        lat=float(os.getenv("MASJID_LAT", "-6.9930")),
        lon=float(os.getenv("MASJID_LON", "110.4195")),
        radius_m=float(os.getenv("MASJID_RADIUS_M", "100.0")),
    )
    poi_kos = POI(
        name="kos",
        lat=float(os.getenv("KOS_LAT", "-6.9940")),
        lon=float(os.getenv("KOS_LON", "110.4225")),
        radius_m=float(os.getenv("KOS_RADIUS_M", "50.0")),
    )
    poi_bar = POI(
        name="bar",
        lat=float(os.getenv("BAR_LAT", "-6.9960")),
        lon=float(os.getenv("BAR_LON", "110.4240")),
        radius_m=float(os.getenv("BAR_RADIUS_M", "100.0")),
    )

    return AppConfig(
        project_id=project_id,
        mqtt_host=mqtt_host,
        mqtt_port=mqtt_port,
        mqtt_keepalive=mqtt_keepalive,
        poi_kampus=poi_kampus,
        poi_masjid=poi_masjid,
        poi_kos=poi_kos,
        poi_bar=poi_bar,
    )
