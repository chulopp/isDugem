"""
Audio RMS and decibel calculation module.
Formula: 20 * log10(rms_value) + 100, clamped to [0, 120].
"""

import math
from typing import Sequence


def rms(samples: Sequence[float]) -> float:
    """
    Root mean square of audio amplitude samples.
    """
    if not samples:
        return 0.0
    sum_squares = sum(s * s for s in samples)
    return math.sqrt(sum_squares / len(samples))


def rms_to_db(rms_value: float) -> float:
    """
    Convert RMS value to decibels (dB).
    Formula: 20 * log10(rms_value) + 100, clamped to [0.0, 120.0].
    """
    if rms_value <= 0.0:
        return 0.0
    db = 20.0 * math.log10(rms_value) + 100.0
    return max(0.0, min(120.0, db))
