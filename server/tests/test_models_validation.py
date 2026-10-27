
import pytest

from models import AnakTelemetry, OrtuTelemetry, PayloadError


def anak_payload():
    return {
        "device_id": "anak",
        "sequence": 1,
        "sent_at_ms": 1760000000000,
        "location": {"lat": -7.05, "lon": 110.44},
        "audio": {"rms": 0.01},
        "motion": {"accel_magnitude": 1.0},
    }


def ortu_payload():
    return {
        "device_id": "ortu",
        "sequence": 1,
        "sent_at_ms": 1760000000000,
        "location": {"lat": -7.05, "lon": 110.44},
        "motion": {
            "accel_magnitude": 1.0,
            "shake_detected": False,
        },
    }


@pytest.mark.parametrize("field", ["sequence", "sent_at_ms"])
@pytest.mark.parametrize("payload_factory", [anak_payload, ortu_payload])
def test_telemetry_requires_fields(field, payload_factory):
    payload = payload_factory()
    del payload[field]

    parser = (
        AnakTelemetry.from_payload
        if payload["device_id"] == "anak"
        else OrtuTelemetry.from_payload
    )

    with pytest.raises(PayloadError):
        parser(payload)


@pytest.mark.parametrize(
    "value",
    [True, False, "1", 1.5, -1, None],
)
@pytest.mark.parametrize("field", ["sequence", "sent_at_ms"])
@pytest.mark.parametrize("payload_factory", [anak_payload, ortu_payload])
def test_telemetry_rejects_invalid_numeric_fields(
    field, value, payload_factory
):
    payload = payload_factory()
    payload[field] = value

    parser = (
        AnakTelemetry.from_payload
        if payload["device_id"] == "anak"
        else OrtuTelemetry.from_payload
    )

    with pytest.raises(PayloadError):
        parser(payload)


@pytest.mark.parametrize("payload_factory", [anak_payload, ortu_payload])
def test_telemetry_accepts_valid_sequence_zero(payload_factory):
    payload = payload_factory()
    payload["sequence"] = 0

    parser = (
        AnakTelemetry.from_payload
        if payload["device_id"] == "anak"
        else OrtuTelemetry.from_payload
    )

    telemetry = parser(payload)
    assert telemetry.sequence == 0


@pytest.mark.parametrize("payload_factory", [anak_payload, ortu_payload])
def test_telemetry_accepts_valid_timestamp(payload_factory):
    payload = payload_factory()

    parser = (
        AnakTelemetry.from_payload
        if payload["device_id"] == "anak"
        else OrtuTelemetry.from_payload
    )

    telemetry = parser(payload)
    assert telemetry.sent_at_ms == 1760000000000