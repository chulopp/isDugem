"""
Unit tests for Audio RMS and decibel calculation.
"""

import math
import pytest
from server.processing.audio_rms import rms, rms_to_db


def test_rms_empty_list():
    assert rms([]) == 0.0


def test_rms_constant_signal():
    samples = [0.5, 0.5, 0.5, 0.5]
    assert math.isclose(rms(samples), 0.5, rel_tol=1e-5)


def test_rms_zero_signal():
    samples = [0.0, 0.0, 0.0]
    assert rms(samples) == 0.0


def test_rms_to_db_zero():
    assert rms_to_db(0.0) == 0.0
    assert rms_to_db(-1.0) == 0.0


def test_rms_to_db_clamping():
    # RMS sangat besar harus di-clamp ke 120 dB
    assert rms_to_db(100.0) == 120.0
    # RMS sangat kecil harus >= 0
    assert rms_to_db(0.000000001) >= 0.0


def test_rms_to_db_formula():
    # 20 * log10(0.1) + 100 = 20 * (-1) + 100 = 80 dB
    val = rms_to_db(0.1)
    assert math.isclose(val, 80.0, rel_tol=1e-5)
