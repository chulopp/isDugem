"""
Configuration loader for RantauGuard server backend.
"""

import os
from dataclasses import dataclass, field
from typing import List, Tuple
from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class POI:
    name: str
    lat: float
    lon: float
    radius_m: float
    sub_points: Tuple[Tuple[float, float], ...] = field(default_factory=tuple)


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
        lat=float(os.getenv("KAMPUS_LAT", "-7.0502")),
        lon=float(os.getenv("KAMPUS_LON", "110.4398")),
        radius_m=float(os.getenv("KAMPUS_RADIUS_M", "150.0")),
        sub_points=((-7.0502, 110.4398), (-7.0492, 110.4410)),
    )
    poi_masjid = POI(
        name="masjid",
        lat=float(os.getenv("MASJID_LAT", "-7.0519")),
        lon=float(os.getenv("MASJID_LON", "110.4398")),
        radius_m=float(os.getenv("MASJID_RADIUS_M", "100.0")),
        sub_points=((-7.0519, 110.4398),),
    )
    poi_kos = POI(
        name="kos",
        lat=float(os.getenv("KOS_LAT", "-7.0612")),
        lon=float(os.getenv("KOS_LON", "110.4338")),
        radius_m=float(os.getenv("KOS_RADIUS_M", "50.0")),
        # Mencakup Kos Mulawarman, Kos Gondang, dan Kos Banjarsari
        sub_points=(
            (-7.0612, 110.4338),  # Kos Mulawarman
            (-7.0562, 110.4402),  # Kos Gondang
            (-7.0558, 110.4368),  # Kos Banjarsari
        ),
    )
    poi_bar = POI(
        name="bar",
        lat=float(os.getenv("BAR_LAT", "-6.9680")),
        lon=float(os.getenv("BAR_LON", "110.4285")),
        radius_m=float(os.getenv("BAR_RADIUS_M", "100.0")),
        # Mencakup RedHare Kota Lama, Marabunta Kota Lama, dan Golden Tiger Semarang Bawah
        sub_points=(
            (-6.9680, 110.4285),  # RedHare Kota Lama
            (-6.9691, 110.4272),  # Marabunta Kota Lama
            (-7.0016, 110.4452),  # Golden Tiger Semarang Bawah
        ),
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
