import math

import pytest

from processing.audio_rms import rms, rms_to_db


def test_rms_empty_list_is_zero():
    assert rms([]) == 0.0


def test_rms_constant_signal():
    assert rms([0.5, 0.5, 0.5, 0.5]) == pytest.approx(0.5)


def test_rms_sine_wave_is_amplitude_over_sqrt2():
    n = 10_000
    samples = [math.sin(2 * math.pi * i / 100) for i in range(n)]
    assert rms(samples) == pytest.approx(1 / math.sqrt(2), rel=1e-3)


def test_rms_handles_negative_samples():
    assert rms([-1.0, 1.0]) == pytest.approx(1.0)


@pytest.mark.parametrize(
    "rms_value, expected_db",
    [(1.0, 100.0), (0.1, 80.0), (0.01, 60.0), (0.001, 40.0)],
)
def test_rms_to_db_known_values(rms_value, expected_db):
    assert rms_to_db(rms_value) == pytest.approx(expected_db)


def test_rms_to_db_clamps_upper_bound():
    assert rms_to_db(1000.0) == 120.0


@pytest.mark.parametrize("bad", [0.0, -0.5, 1e-9, float("nan"), float("inf"), None])
def test_rms_to_db_invalid_or_tiny_returns_lower_bound(bad):
    assert rms_to_db(bad) == 0.0


def test_rms_to_db_matches_formula_for_schema_example():
    # Cross-check: contoh skema rms=0.042 menurut rumus PRD = 20*log10(0.042)+100 ~= 72.46 dB
    # (contoh payload di mqtt-schema.md menulis 61.2 dB; angka itu hanya ilustrasi).
    assert rms_to_db(0.042) == pytest.approx(72.46, abs=0.01)