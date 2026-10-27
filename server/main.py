from __future__ import annotations

import json
import logging
import signal
import time
from threading import RLock
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

PublishFn = Callable[..., Any]

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
        self._last_anak_received_s: Optional[float] = None
        self.current_status: Optional[str] = None
        self.last_alert: Optional[Alert] = None
        self._last_publish_s: float = 0.0
        self._last_anak_key: Optional[Tuple[int, int]] = None
        self._pending_alerts: dict[int, tuple[Alert, float]] = {}
        self._pending_publish_order: dict[int, int] = {}
        self._publish_order = 0
        self._last_committed_publish_order = 0
        self._publish_lock = RLock()

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
        except Exception:
            logger.exception(
                "Kesalahan tak terduga saat memproses pesan dari topik %s",
                topic,
            )

    def _handle_anak(self, data: Any) -> None:
        tel = AnakTelemetry.from_payload(data)
        now_s = self._clock()

        if tel.sent_at_ms is not None:
            key = (tel.sequence, tel.sent_at_ms)
            last_key = self._last_anak_key

            if last_key is not None:
                last_sequence, last_sent_at_ms = last_key

                if tel.sequence < last_sequence:
                    # Evaluasi apakah paket adalah reset sequence sah atau paket out-of-order usang:
                    # 1. Waktu pengiriman maju (sent_at_ms >= last_sent_at_ms):
                    #    - Sequence kembali ke awal (seq <= 5) -> client restart / sesi baru.
                    #    - Sequence melompat mundur sangat besar (> 1000) DENGAN waktu maju -> counter rollover.
                    # 2. Jika waktu pengiriman lebih lama (sent_at_ms < last_sent_at_ms):
                    #    - Paket tersebut dibuat di masa lalu, sehingga merupakan paket out-of-order/tertunda
                    #      dan WAJIB dibuang agar tidak menimpa status live.
                    #    - Pengecualian hanya jika perangkat restart setelah jeda telemetri basi (stale >= 60s)
                    #      dengan sequence kembali ke 1.
                    time_advanced = tel.sent_at_ms >= last_sent_at_ms
                    session_idle_s = now_s - (self._last_anak_received_s or 0)
                    restart_after_stale = tel.sequence <= 1 and session_idle_s >= self.cfg.telemetry_stale_after_s

                    is_reset = (
                        (time_advanced and (tel.sequence <= 5 or (last_sequence - tel.sequence > 1000)))
                        or restart_after_stale
                    )

                    if is_reset:
                        logger.info(
                            "Sequence reset terdeteksi: seq=%d (sebelumnya=%d, sent_at=%d, last_sent_at=%d)",
                            tel.sequence,
                            last_sequence,
                            tel.sent_at_ms,
                            last_sent_at_ms,
                        )
                    else:
                        logger.warning(
                            "Telemetry anak out-of-order dibuang: "
                            "sequence=%d (sent_at=%d), sequence terakhir=%d (sent_at=%d)",
                            tel.sequence,
                            tel.sent_at_ms,
                            last_sequence,
                            last_sent_at_ms,
                        )
                        return

                if key == last_key:
                    logger.debug("Duplikat telemetri anak dibuang: %s", key)
                    return

            self._last_anak_key = key

        self.latest_anak = tel
        self._last_anak_received_s = now_s
        alert = self.evaluate(tel, now_s)

        logger.info(
            "Telemetri anak diproses: seq=%d, status=%s, near=%s (%.1fm), db=%.1f",
            tel.sequence,
            alert.status,
            alert.context.nearest_poi,
            alert.context.distance_m,
            alert.context.db,
        )

        # Bandingkan dengan status terakhir yang masih pending,
        # bukan hanya status yang sudah dikonfirmasi broker.
        latest_pending = (
            next(reversed(self._pending_alerts.values()))
            if self._pending_alerts
            else None
        )

        reference_status = (
            latest_pending[0].status
            if latest_pending is not None
            else self.current_status
        )

        changed = alert.status != reference_status

        # Periksa apakah jarak atau alasan berubah signifikan saat status sama
        reason_changed = False
        if not changed and self.last_alert is not None:
            dist_diff = abs(alert.context.distance_m - self.last_alert.context.distance_m)
            if dist_diff >= 15.0 or alert.reason != self.last_alert.reason:
                reason_changed = True

        heartbeat = self.cfg.alert_heartbeat_s
        heartbeat_due = heartbeat > 0 and (
            now_s - self._last_publish_s
        ) >= heartbeat

        # Jangan mengantrekan alert identik jika status tersebut
        # sudah menunggu konfirmasi publish tanpa perubahan alasan.
        same_status_pending = (
            latest_pending is not None
            and latest_pending[0].status == alert.status
            and not reason_changed
        )

        if changed or reason_changed or (heartbeat_due and not same_status_pending):
            self._publish_alert(alert, now_s)

    def _handle_ortu(self, data: Any) -> None:
        tel = OrtuTelemetry.from_payload(data)
        self.latest_ortu = tel
        if tel.shake_detected:
            logger.info("HP ortu terdeteksi digoyang (shake) seq=%d", tel.sequence)

    @property
    def anak_telemetry_stale(self) -> bool:
        if self._last_anak_received_s is None:
            return True

        age_s = self._clock() - self._last_anak_received_s
        return age_s > self.cfg.telemetry_stale_after_s

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
        with self._publish_lock:
            logger.info(
                "Mempublikasikan alert ke %s: status=%s (%s)",
                self.cfg.topic_alerts,
                alert.status,
                alert.reason,
            )
            try:
                try:
                    result = self._publish(
                        self.cfg.topic_alerts,
                        alert.to_payload(),
                        retain=True,
                    )
                except TypeError:
                    result = self._publish(
                        self.cfg.topic_alerts,
                        alert.to_payload(),
                    )
            except Exception:
                logger.exception("Gagal mengantrekan publish alert")
                return

            if result is False:
                logger.error(
                    "Alert gagal dimasukkan ke antrean publish: status=%s",
                    alert.status,
                )
                return

            self._publish_order += 1
            order = self._publish_order

            if type(result) is int:
                # Simpan urutan publish bersama MID agar konfirmasi yang
                # datang terlambat tidak mengembalikan status ke alert lama.
                self._pending_alerts[result] = (alert, now_s)
                self._pending_publish_order[result] = order
                return

            # Kompatibilitas dengan publisher sinkron/tiruan
            # yang mengembalikan None.
            self._commit_published_alert(alert, now_s, order)

    def handle_publish_confirm(self, mid: int, success: bool) -> None:
        with self._publish_lock:
            pending = self._pending_alerts.pop(mid, None)
            order = self._pending_publish_order.pop(mid, None)

            if pending is None or order is None:
                logger.debug(
                    "Konfirmasi publish tanpa alert pending diabaikan: mid=%s",
                    mid,
                )
                return

            if not success:
                logger.error("Publish alert gagal dikonfirmasi: mid=%s", mid)
                return

            alert, now_s = pending
            self._commit_published_alert(alert, now_s, order)

    def _commit_published_alert(
        self,
        alert: Alert,
        now_s: float,
        order: int,
    ) -> None:
        # Jangan biarkan konfirmasi lama menimpa alert lebih baru
        # yang sudah berhasil dikonfirmasi.
        if order < self._last_committed_publish_order:
            logger.debug(
                "Konfirmasi alert lama diabaikan: order=%s, terakhir=%s",
                order,
                self._last_committed_publish_order,
            )
            return

        self.current_status = alert.status
        self.last_alert = alert
        self._last_publish_s = now_s
        self._last_committed_publish_order = order

def main() -> None:
    cfg = load_config()
    logging.basicConfig(
        level=getattr(logging, cfg.log_level, logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    logger.info("RantauGuard server | PROJECT_ID=%s | prefix=%s", cfg.project_id, cfg.topic_prefix)

    client = MqttClient(cfg, cfg.subscribe_topics)
    server = GuardianServer(cfg, publish=client.publish_json)
    client.on_publish_confirm = server.handle_publish_confirm
    client.on_message = server.handle_message

    def _shutdown(signum, frame) -> None:  # noqa: ANN001
        logger.info("Sinyal %s diterima, menutup koneksi...", signum)
        client.stop()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    client.run_forever()

if __name__ == "__main__":
    main()