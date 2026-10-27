
import pytest

from config import (
    ConfigError,
    load_config,
    parseTime,
    parseWindows,
)


@pytest.mark.parametrize(
    "value",
    ["8:00", "08:0", "25:00", "08:60", "abc"],
)
def test_parse_time_rejects_invalid_format(value):
    with pytest.raises(ConfigError):
        parseTime(value)


def test_parse_time_accepts_valid_format():
    assert parseTime("08:00").hour == 8


@pytest.mark.parametrize(
    "value",
    [
        "08:00-09:00,",
        ",08:00-09:00",
        "08:00-09:00,,10:00-11:00",
    ],
)
def test_parse_windows_rejects_empty_items(value):
    with pytest.raises(ConfigError):
        parseWindows(value)


def test_parse_windows_accepts_overnight_window():
    windows = parseWindows("22:00-05:00")
    assert len(windows) == 1
    assert windows[0].start.hour == 22
    assert windows[0].end.hour == 5


@pytest.mark.parametrize("port", ["0", "65536", "70000"])
def test_config_rejects_invalid_mqtt_port(monkeypatch, port):
    monkeypatch.setenv("MQTT_PORT", port)
    with pytest.raises(ConfigError):
        load_config()


@pytest.mark.parametrize("keepalive", ["0", "-1"])
def test_config_rejects_invalid_keepalive(monkeypatch, keepalive):
    monkeypatch.setenv("MQTT_KEEPALIVE", keepalive)
    with pytest.raises(ConfigError):
        load_config()


@pytest.mark.parametrize("heartbeat", ["NaN", "inf", "-inf", "-1"])
def test_config_rejects_invalid_heartbeat(monkeypatch, heartbeat):
    monkeypatch.setenv("ALERT_HEARTBEAT_S", heartbeat)
    with pytest.raises(ConfigError):
        load_config()


def test_config_accepts_zero_heartbeat(monkeypatch):
    monkeypatch.setenv("ALERT_HEARTBEAT_S", "0.0")
    assert load_config().alert_heartbeat_s == 0.0


def test_config_rejects_empty_mqtt_host(monkeypatch):
    monkeypatch.setenv("MQTT_HOST", " ")
    with pytest.raises(ConfigError):
        load_config()