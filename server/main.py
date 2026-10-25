from __future__ import annotations

import json
import logging
import signal
import time
from dataclasses import replace
from datetime import datetime
from typing import Any, Callable, Dict, Optional, Tuple
from zoneinfo import ZoneInfo

from config import Config, load_config
from models import Alert, AlertContext, AnakTelemetry, OrtuTelemetry, PayloadError
from mqtt_client import MqttClient
from processing.audio_rms import DB_MAX, DB_MIN, rms_to_db
from processing.decision_engine import (
    build_context,
    build_reason,
    classify,
    get_time_label,
    nearest_poi,
)

logger = logging.getLogger("rantauguard.server")

PublishFn = Callable[[str, Dict[str, Any]], Any]

DB_MISMATCH_LOG_THRESHOLD = 6.0

class GuardianServer:
    def __init__(
        self,
        cfg: Config,
        publish: PublishFn,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.cfg = cfg
        self._publish = publish
        self._clock = clock
        self._tz = ZoneInfo(cfg.timezone)

        self.latest_anak: Optional[AnakTelemetry] = None
        self.latest_ortu: Optional[OrtuTelemetry] = None
        self.current_status: Optional[str] = None
        self.last_alert: Optional[Alert] = None
        self._last_publish_s: float = 0.0
        self._last_anak_key: Optional[Tuple[int, int]] = None

    def handle_message(self, topic: str, raw: bytes) -> None:
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            logger.warning("Payload bukan JSON valid pada topik %s", topic)
            return

        try:
            if topic == self.cfg.topic_anak_telemetry:
                self._handle_anak(data)
            elif topic == self.cfg.topic_ortu_telemetry:
                self._handle_ortu(data)
            elif topic == self.cfg.topic_command_ping:
                self._handle_ping(data)
            else:
                logger.debug("Topik diabaikan: %s", topic)
        except PayloadError as exc:
            logger.warning("Payload melanggar kontrak (%s): %s", topic, exc)

    def _handle_anak(self, data: Any) -> None:
        tel = AnakTelemetry.from_payload(data)

        if tel.sent_at_ms is not None:
            key = (tel.sequence, tel.sent_at_ms)
            if key == self._last_anak_key:
                logger.debug("Duplikat telemetri anak dibuang: %s", key)
                return
            self._last_anak_key = key

        self.latest_anak = tel
        now_s = self._clock()
        alert = self.evaluate(tel, now_s)

        changed = alert.status != self.current_status
        heartbeat = self.cfg.alert_heartbeat_s
        heartbeat_due = heartbeat > 0 and (now_s - self._last_publish_s) >= heartbeat

        if changed:
            logger.info("Status %s -> %s | %s", self.current_status, alert.status, alert.reason)
        if changed or heartbeat_due:
            self._publish_alert(alert, now_s)

    def _handle_ortu(self, data: Any) -> None:
        tel = OrtuTelemetry.from_payload(data)
        self.latest_ortu = tel
        if tel.shake_detected:
            logger.info("HP ortu terdeteksi digoyang (shake) seq=%d", tel.sequence)

    def _handle_ping(self, data: Any) -> None:
        who = data.get("triggered_by", "?") if isinstance(data, dict) else "?"
        logger.info("command/ping diterima dari %s", who)
        if self.cfg.ping_republish and self.last_alert is not None:
            now_s = self._clock()
            refreshed = replace(self.last_alert, timestamp_ms=int(now_s * 1000))
            self._publish_alert(refreshed, now_s)

    def evaluate(self, tel: AnakTelemetry, now_s: Optional[float] = None) -> Alert:
        """Telemetri anak -> time_label -> jarak POI -> dB -> classify -> Alert."""
        now_s = self._clock() if now_s is None else now_s
        local_dt = self._local_datetime(tel, now_s)

        time_label = get_time_label(
            local_dt.time(),
            self.cfg.kuliah_window,
            self.cfg.sholat_windows,
            self.cfg.malam_window,
        )
        db_level = self._db_level(tel)
        ctx = build_context(tel.lat, tel.lon, db_level, time_label, self.cfg.poi)
        status = classify(ctx, self.cfg.radii_m)
        near_name, near_dist = nearest_poi(ctx)
        reason = build_reason(status, ctx, local_dt.strftime("%H:%M"), self.cfg.radii_m)

        return Alert(
            status=status,
            reason=reason,
            timestamp_ms=int(now_s * 1000),
            context=AlertContext(
                time_label=time_label,
                nearest_poi=near_name,
                distance_m=near_dist,
                db=db_level,
            ),
        )

    def _local_datetime(self, tel: AnakTelemetry, now_s: float) -> datetime:
        if self.cfg.use_server_clock or tel.sent_at_ms is None:
            epoch_s = now_s
        else:
            epoch_s = tel.sent_at_ms / 1000.0
        return datetime.fromtimestamp(epoch_s, tz=self._tz)

    @staticmethod
    def _db_level(tel: AnakTelemetry) -> float:
        if tel.rms is not None:
            db = rms_to_db(tel.rms)
            if tel.db is not None and abs(db - tel.db) > DB_MISMATCH_LOG_THRESHOLD:
                logger.debug(
                    "dB payload (%.1f) beda dari hitungan server (%.1f) untuk rms=%.4f",
                    tel.db, db, tel.rms,
                )
            return db
        return max(DB_MIN, min(DB_MAX, float(tel.db)))  # type: ignore[arg-type]

    def _publish_alert(self, alert: Alert, now_s: float) -> None:
        self._publish(self.cfg.topic_alerts, alert.to_payload())
        self.current_status = alert.status
        self.last_alert = alert
        self._last_publish_s = now_s

def main() -> None:
    cfg = load_config()
    logging.basicConfig(
        level=getattr(logging, cfg.log_level, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    logger.info("RantauGuard server | PROJECT_ID=%s | prefix=%s", cfg.project_id, cfg.topic_prefix)

    client = MqttClient(cfg, cfg.subscribe_topics)
    server = GuardianServer(cfg, publish=client.publish_json)
    client.on_message = server.handle_message

    def _shutdown(signum, frame) -> None:  # noqa: ANN001
        logger.info("Sinyal %s diterima, menutup koneksi...", signum)
        client.stop()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    client.run_forever()

if __name__ == "__main__":
    main()