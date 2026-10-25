"""
Entrypoint for RantauGuard backend processing server.
Subscribes to telemetry from edge devices, computes geofence & audio metrics,
evaluates rules via decision engine, and publishes alerts to MQTT broker.
"""

import sys
import time
from datetime import datetime
from typing import Optional

from config import load_config
from models import Context, AlertContext, Alert, AlertStatus
from mqtt_client import ServerMqttClient
from processing import haversine_distance_m, classify


def get_current_time_label() -> str:
    """
    Menentukan time_label berdasarkan jam sekarang (atau skenario demo).
    Bisa dioverride dengan environment variable DEMO_TIME_LABEL.
    """
    now = datetime.now()
    hour = now.hour

    if 8 <= hour < 12 or 13 <= hour < 16:
        return "jam_kuliah"
    elif hour in (12, 18, 19):
        return "waktu_sholat"
    elif hour >= 22 or hour < 4:
        return "jam_malam"
    return "lainnya"


class RantauGuardServer:
    def __init__(self):
        self.config = load_config()
        self.last_status: Optional[AlertStatus] = None
        self.mqtt = ServerMqttClient(self.config, self.handle_incoming_telemetry)

    def handle_incoming_telemetry(self, topic: str, payload: dict):
        device_id = payload.get("device_id")

        if device_id == "anak":
            self.process_anak_telemetry(payload)
        elif device_id == "ortu":
            print(f"[ORTU TELEMETRY] Sequence: {payload.get('sequence')} | Shake: {payload.get('motion', {}).get('shake_detected')}")

    def process_anak_telemetry(self, payload: dict):
        loc = payload.get("location", {})
        lat = loc.get("lat", 0.0)
        lon = loc.get("lon", 0.0)

        audio = payload.get("audio", {})
        db_level = float(audio.get("db", 0.0))

        # Hitung jarak ke setiap POI menggunakan formula Haversine
        dist_kampus = haversine_distance_m(lat, lon, self.config.poi_kampus.lat, self.config.poi_kampus.lon)
        dist_masjid = haversine_distance_m(lat, lon, self.config.poi_masjid.lat, self.config.poi_masjid.lon)
        dist_kos = haversine_distance_m(lat, lon, self.config.poi_kos.lat, self.config.poi_kos.lon)
        dist_bar = haversine_distance_m(lat, lon, self.config.poi_bar.lat, self.config.poi_bar.lon)

        claimed_at_kos = dist_kos <= self.config.poi_kos.radius_m
        time_label = get_current_time_label()

        # Buat konteks evaluasi
        ctx = Context(
            time_label=time_label,
            distance_kampus_m=dist_kampus,
            distance_masjid_m=dist_masjid,
            distance_kos_m=dist_kos,
            distance_bar_m=dist_bar,
            db_level=db_level,
            claimed_at_kos=claimed_at_kos,
        )

        # Klasifikasikan melalui decision engine
        status = classify(ctx)

        # Cari POI terdekat untuk konteks alert
        poi_distances = [
            ("kampus", dist_kampus),
            ("masjid", dist_masjid),
            ("kos", dist_kos),
            ("bar", dist_bar),
        ]
        nearest_poi, nearest_dist = min(poi_distances, key=lambda x: x[1])

        print(f"[PROCESS] Jarak POI: Kampus={dist_kampus:.1f}m, Masjid={dist_masjid:.1f}m, Kos={dist_kos:.1f}m, Bar={dist_bar:.1f}m | dB={db_level:.1f} | Status={status.value}")

        # Publish alert jika status berubah atau kondisi berbahaya
        if status != self.last_status:
            self.last_status = status
            reason_map = {
                AlertStatus.SEDANG_KULIAH: f"Berada di kampus ({dist_kampus:.1f}m) dengan suasana kondusif ({db_level:.1f} dB)",
                AlertStatus.ALERT_BOLOS_KULIAH: f"Di luar kampus ({dist_kampus:.1f}m) pada jam kuliah",
                AlertStatus.WARNING_BELUM_KE_MASJID: f"Belum berada di masjid ({dist_masjid:.1f}m) pada waktu sholat",
                AlertStatus.ISTIRAHAT_DI_KOS: f"Berada di kos ({dist_kos:.1f}m) dalam keadaan tenang ({db_level:.1f} dB)",
                AlertStatus.CRITICAL_TERDETEKSI_DI_BAR: f"Terdeteksi di area bar ({dist_bar:.1f}m) dengan suara bising ({db_level:.1f} dB)",
                AlertStatus.ANOMALY_FAKE_GPS: f"Klaim GPS di kos ({dist_kos:.1f}m) tetapi suara lingkungan sangat bising ({db_level:.1f} dB) - Indikasi Fake GPS!",
                AlertStatus.NORMAL: "Kondisi normal / di luar jadwal khusus",
            }

            alert = Alert(
                status=status,
                reason=reason_map.get(status, "Status updated"),
                timestamp_ms=int(time.time() * 1000),
                context=AlertContext(
                    time_label=time_label,
                    nearest_poi=nearest_poi,
                    distance_m=nearest_dist,
                    db=db_level,
                ),
            )
            self.mqtt.publish_alert(alert.to_dict())

    def run(self):
        print("=" * 60)
        print("  RANTAUGUARD BACKEND PROCESSING SERVER (isDugem)")
        print(f"  Project ID: {self.config.project_id}")
        print(f"  Broker:     {self.config.mqtt_host}:{self.config.mqtt_port}")
        print("=" * 60)
        self.mqtt.start()

        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[SERVER] Menghentikan server...")
            self.mqtt.stop()
            print("[SERVER] Selesai.")


if __name__ == "__main__":
    server = RantauGuardServer()
    server.run()
