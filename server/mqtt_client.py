from __future__ import annotations
import json
import logging
import ssl
import uuid
from typing import Any, Callable, Dict, Optional, Sequence
import paho.mqtt.client as mqtt
from config import Config

logger = logging.getLogger("rantauguard.mqtt")
MessageHandler = Callable[[str, bytes], None]

class MqttClient:
    def __init__(self, cfg: Config, subscriptions: Sequence[str]) -> None:
        self._cfg = cfg
        self._subscriptions = tuple(subscriptions)
        self.on_message: Optional[MessageHandler] = None

        client_id = f"rantauguard-server-{cfg.project_id}-{uuid.uuid4().hex[:8]}"
        self._client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=client_id,
            protocol=mqtt.MQTTv311,
        )

        if cfg.mqtt_use_tls:
            context = ssl.create_default_context()
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            self._client.tls_set_context(context)
        if cfg.mqtt_username:
            self._client.username_pw_set(cfg.mqtt_username, cfg.mqtt_password)

        self._client.reconnect_delay_set(min_delay=1, max_delay=30)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        if reason_code.is_failure:
            logger.error("Koneksi MQTT ditolak: %s", reason_code)
            return
        logger.info("Terhubung ke %s:%s", self._cfg.mqtt_host, self._cfg.mqtt_port)

        for topic in self._subscriptions:
            client.subscribe(topic, qos=self._cfg.mqtt_qos)
            logger.info("Subscribe: %s (QoS %d)", topic, self._cfg.mqtt_qos)

    def _on_disconnect(self, client, userdata, disconnect_flags, reason_code, properties) -> None:
        if reason_code.is_failure:
            logger.warning("Koneksi MQTT terputus (%s), mencoba menyambung ulang...", reason_code)
        else:
            logger.info("Koneksi MQTT ditutup.")

    def _on_message(self, client, userdata, msg) -> None:
        if self.on_message is None:
            return
        try:
            self.on_message(msg.topic, bytes(msg.payload))
        except Exception:  
            logger.exception("Gagal memproses pesan dari topik %s", msg.topic)

    def publish_json(self, topic: str, payload: Dict[str, Any], retain: bool = False) -> bool:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        info = self._client.publish(topic, body, qos=self._cfg.mqtt_qos, retain=retain)
        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            logger.warning("Publish ke %s gagal (rc=%s)", topic, info.rc)
            return False
        logger.debug("Publish %s: %s", topic, body)
        return True

    def run_forever(self) -> None:
        self._client.connect_async(self._cfg.mqtt_host, self._cfg.mqtt_port, self._cfg.mqtt_keepalive)
        self._client.loop_forever(retry_first_connection=True)

    def stop(self) -> None:
        self._client.disconnect()