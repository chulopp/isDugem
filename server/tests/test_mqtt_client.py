
from unittest.mock import MagicMock

import paho.mqtt.client as mqtt

from mqtt_client import MqttClient


def make_client(monkeypatch):
    cfg = MagicMock()
    cfg.project_id = "isdugem_tim_01"
    cfg.mqtt_use_tls = False
    cfg.mqtt_username = None
    cfg.mqtt_password = None
    cfg.mqtt_qos = 1

    subscriptions = (
        "rantauguard/isdugem_tim_01/edge/anak/telemetry",
        "rantauguard/isdugem_tim_01/edge/ortu/telemetry",
        "rantauguard/isdugem_tim_01/command/ping",
    )

    client = MqttClient(cfg, subscriptions)
    return client, subscriptions


def test_connect_subscribes_all_topics(monkeypatch):
    client, subscriptions = make_client(monkeypatch)
    mqtt_client = MagicMock()
    mqtt_client.subscribe.return_value = (
        mqtt.MQTT_ERR_SUCCESS,
        123,
    )

    client._on_connect(
        mqtt_client,
        None,
        {},
        MagicMock(is_failure=False),
        None,
    )

    assert mqtt_client.subscribe.call_count == len(subscriptions)

    actual_topics = [
        call.args[0]
        for call in mqtt_client.subscribe.call_args_list
    ]
    assert actual_topics == list(subscriptions)

    for call in mqtt_client.subscribe.call_args_list:
        assert call.kwargs["qos"] == 1


def test_reconnect_subscribes_again(monkeypatch):
    client, subscriptions = make_client(monkeypatch)
    mqtt_client = MagicMock()
    mqtt_client.subscribe.return_value = (
        mqtt.MQTT_ERR_SUCCESS,
        123,
    )

    success_reason = MagicMock(is_failure=False)

    # Simulasi dua koneksi berhasil: koneksi awal dan reconnect.
    client._on_connect(
        mqtt_client, None, {}, success_reason, None
    )
    client._on_connect(
        mqtt_client, None, {}, success_reason, None
    )

    assert mqtt_client.subscribe.call_count == 2 * len(subscriptions)


def test_failed_connection_does_not_subscribe(monkeypatch):
    client, _ = make_client(monkeypatch)
    mqtt_client = MagicMock()

    client._on_connect(
        mqtt_client,
        None,
        {},
        MagicMock(is_failure=True),
        None,
    )

    mqtt_client.subscribe.assert_not_called()


def test_subscribe_failure_is_logged(monkeypatch, caplog):
    client, _ = make_client(monkeypatch)
    mqtt_client = MagicMock()
    mqtt_client.subscribe.return_value = (
        mqtt.MQTT_ERR_SUCCESS,
        123,
    )

    reason_code = MagicMock()
    reason_code.is_failure = True
    reason_code.__str__.return_value = "Not authorized"

    reason_codes = [reason_code]

    with caplog.at_level("ERROR", logger="rantauguard.mqtt"):
        client._on_subscribe(
            mqtt_client,
            None,
            123,
            reason_codes,
            None,
        )

    assert "Subscription ditolak broker" in caplog.text
    assert "Not authorized" in caplog.text


def test_publish_json_returns_mid_on_success(monkeypatch):
    client, _ = make_client(monkeypatch)
    info = MagicMock()
    info.rc = mqtt.MQTT_ERR_SUCCESS
    info.mid = 42
    client._client.publish = MagicMock(return_value=info)

    result = client.publish_json(
        "rantauguard/isdugem_tim_01/alerts",
        {"status": "NORMAL"},
    )

    assert result == 42


def test_publish_json_returns_false_on_queue_error(monkeypatch):
    client, _ = make_client(monkeypatch)
    info = MagicMock()
    info.rc = mqtt.MQTT_ERR_NO_CONN
    info.mid = 42
    client._client.publish = MagicMock(return_value=info)

    result = client.publish_json(
        "rantauguard/isdugem_tim_01/alerts",
        {"status": "NORMAL"},
    )

    assert result is False
