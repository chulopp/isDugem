from __future__ import annotations
import json
import logging
import ssl
import uuid
from typing import Any, Callable, Dict, Optional, Sequence
import paho.mqtt.client as mqtt
from config import Config

try:
    import certifi
    _DEFAULT_CAFILE: Optional[str] = certifi.where()
except ImportError:
    _DEFAULT_CAFILE = None

logger = logging.getLogger("rantauguard.mqtt")
MessageHandler = Callable[[str, bytes], None]
PublishConfirmHandler = Callable[[int, bool], None]

class MqttClient:
    def __init__(self, cfg: Config, subscriptions: Sequence[str]) -> None:
        self._cfg = cfg
        self._subscriptions = tuple(subscriptions)
        self.on_message: Optional[MessageHandler] = None
        self.on_publish_confirm: Optional[PublishConfirmHandler] = None

        client_id = f"rantauguard-server-{cfg.project_id}-{uuid.uuid4().hex[:8]}"
        self._client = mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
            client_id=client_id,
            protocol=mqtt.MQTTv311,
        )

        if cfg.mqtt_use_tls:
            context = ssl.create_default_context(cafile=_DEFAULT_CAFILE)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            self._client.tls_set_context(context)
        if cfg.mqtt_username:
            self._client.username_pw_set(cfg.mqtt_username, cfg.mqtt_password)

        self._client.reconnect_delay_set(min_delay=1, max_delay=30)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message
        self._client.on_publish = self._on_publish
        self._client.on_subscribe = self._on_subscribe

    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        if reason_code.is_failure:
            logger.error("Koneksi MQTT ditolak: %s", reason_code)
            return
        logger.info("Terhubung ke %s:%s", self._cfg.mqtt_host, self._cfg.mqtt_port)

        for topic in self._subscriptions:
            result, mid = client.subscribe(
                topic,
                qos=self._cfg.mqtt_qos,
            )

            if result != mqtt.MQTT_ERR_SUCCESS:
                logger.error(
                    "Permintaan subscribe gagal: topic=%s, rc=%s",
                    topic,
                    result,
                )
            else:
                logger.info(
                    "Permintaan subscribe dikirim: topic=%s, mid=%s",
                    topic,
                    mid,
                )

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

    def publish_json(
        self,
        topic: str,
        payload: Dict[str, Any],
        retain: bool = False,
    ) -> int | bool:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        info = self._client.publish(
            topic,
            body,
            qos=self._cfg.mqtt_qos,
            retain=retain,
        )

        if info.rc != mqtt.MQTT_ERR_SUCCESS:
            logger.warning("Publish ke %s gagal (rc=%s)", topic, info.rc)
            return False

        logger.debug(
            "Publish masuk antrean lokal: topic=%s, mid=%s",
            topic,
            info.mid,
        )
        return info.mid

    def connect(self) -> None:
        self._client.connect_async(self._cfg.mqtt_host, self._cfg.mqtt_port, self._cfg.mqtt_keepalive)

    def run_forever(self) -> None:
        self.connect()
        self._client.loop_forever(retry_first_connection=True)

    def stop(self) -> None:
        self._client.disconnect()

    def _on_publish(self, client, userdata, mid, reason_code, properties) -> None:
        success = not reason_code.is_failure

        if success:
            logger.info("Publish dikonfirmasi broker: mid=%s", mid)
        else:
            logger.error(
                "Broker menolak publish: mid=%s, reason=%s",
                mid,
                reason_code,
            )

        if self.on_publish_confirm is not None:
            try:
                self.on_publish_confirm(mid, success)
            except Exception:
                logger.exception(
                    "Gagal meneruskan konfirmasi publish mid=%s",
                    mid,
                )

    def _on_subscribe(
        self, client, userdata, mid, reason_code_list, properties
    ) -> None:
        failures = [
            str(reason)
            for reason in reason_code_list
            if reason.is_failure
        ]

        if failures:
            logger.error(
                "Subscription ditolak broker: mid=%s, reason=%s",
                mid,
                ", ".join(failures),
            )
            return

        logger.info(
            "Subscription dikonfirmasi broker: mid=%s",
            mid,
        )