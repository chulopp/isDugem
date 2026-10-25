"""
MQTT client helper for RantauGuard server.
Connects via paho-mqtt over TLS to HiveMQ public broker.
"""

import json
import ssl
import sys
from typing import Callable, Any
import paho.mqtt.client as mqtt

try:
    from .config import AppConfig
except ImportError:
    from config import AppConfig


class ServerMqttClient:
    def __init__(self, config: AppConfig, on_telemetry_callback: Callable[[str, dict], None]):
        self.config = config
        self.on_telemetry_callback = on_telemetry_callback

        # Support both paho-mqtt v1 and v2 API
        try:
            self.client = mqtt.Client(
                mqtt.CallbackAPIVersion.VERSION2,
                client_id=f"rantauguard_server_{config.project_id}",
            )
        except AttributeError:
            self.client = mqtt.Client(
                client_id=f"rantauguard_server_{config.project_id}"
            )

        self._setup_callbacks()

    def _setup_callbacks(self):
        self.client.on_connect = self._on_connect
        self.client.on_disconnect = self._on_disconnect
        self.client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, rc, properties=None):
        rc_code = rc if isinstance(rc, int) else getattr(rc, "value", rc)
        if rc_code == 0:
            print(f"[MQTT] Terhubung ke broker {self.config.mqtt_host}:{self.config.mqtt_port}")
            # Subscribe ke telemetry anak dan ortu
            client.subscribe(self.config.topic_anak_telemetry, qos=1)
            client.subscribe(self.config.topic_ortu_telemetry, qos=1)
            print(f"[MQTT] Subscribed to:\n  - {self.config.topic_anak_telemetry}\n  - {self.config.topic_ortu_telemetry}")
        else:
            print(f"[MQTT] Gagal terhubung, return code: {rc_code}")

    def _on_disconnect(self, client, userdata, rc, properties=None):
        print(f"[MQTT] Terputus dari broker (code: {rc})")

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
            self.on_telemetry_callback(msg.topic, payload)
        except Exception as e:
            print(f"[MQTT] Gagal memproses pesan pada topik {msg.topic}: {e}")

    def connect(self):
        if self.config.mqtt_port == 8883:
            # Aktifkan TLS untuk port 8883
            context = ssl.create_default_context()
            self.client.tls_set_context(context)

        self.client.connect(
            self.config.mqtt_host,
            self.config.mqtt_port,
            self.config.mqtt_keepalive,
        )

    def start(self):
        self.connect()
        self.client.loop_start()

    def stop(self):
        self.client.loop_stop()
        self.client.disconnect()

    def publish_alert(self, payload: dict):
        msg = json.dumps(payload)
        self.client.publish(self.config.topic_alerts, msg, qos=1)
        print(f"[ALERT PUBLISHED] {self.config.topic_alerts} -> {payload.get('status')}")
