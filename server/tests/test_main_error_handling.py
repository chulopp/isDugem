
import json
import logging
from unittest.mock import Mock

import pytest

from main import GuardianServer
from models import PayloadError


@pytest.fixture
def server():
    cfg = Mock()
    cfg.timezone = "Asia/Jakarta"
    cfg.topic_anak_telemetry = "test/anak"
    cfg.topic_ortu_telemetry = "test/ortu"
    cfg.topic_command_ping = "test/ping"
    cfg.topic_alerts = "test/alerts"

    return GuardianServer(cfg=cfg, publish=Mock())


def test_invalid_json_is_logged_and_ignored(server, caplog):
    with caplog.at_level(logging.WARNING, logger="rantauguard.server"):
        server.handle_message("test/anak", b"{invalid json")

    assert "Payload bukan JSON valid" in caplog.text


def test_payload_error_is_logged_and_ignored(server, caplog):
    server._handle_anak = Mock(
        side_effect=PayloadError("sequence wajib ada")
    )

    with caplog.at_level(logging.WARNING, logger="rantauguard.server"):
        server.handle_message(
            "test/anak",
            json.dumps({}).encode("utf-8"),
        )

    assert "Payload melanggar kontrak" in caplog.text
    assert "sequence wajib ada" in caplog.text


def test_unexpected_error_is_logged_and_does_not_escape(
    server, caplog
):
    server._handle_anak = Mock(
        side_effect=RuntimeError("simulated failure")
    )

    with caplog.at_level(logging.ERROR, logger="rantauguard.server"):
        server.handle_message(
            "test/anak",
            json.dumps({}).encode("utf-8"),
        )

    assert "Kesalahan tak terduga" in caplog.text
    assert "simulated failure" in caplog.text
    assert "Traceback" in caplog.text


def test_message_after_unexpected_error_is_still_processed(server):
    handler = Mock(
        side_effect=[RuntimeError("simulated failure"), None]
    )
    server._handle_anak = handler

    payload = json.dumps({}).encode("utf-8")

    # Pesan pertama mengalami kesalahan tak terduga.
    server.handle_message("test/anak", payload)

    # Pesan kedua tetap mencapai handler.
    server.handle_message("test/anak", payload)

    assert handler.call_count == 2
