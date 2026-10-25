from __future__ import annotations
import math
from typing import Sequence

DB_MIN = 0.0
DB_MAX = 120.0
DB_OFFSET = 100.0

def rms(samples: Sequence[float]) -> float:
    if len(samples) == 0:
        return 0.0
    return math.sqrt(sum(float(s) * float(s) for s in samples) / len(samples))

def rms_to_db(rms_value: float) -> float:
    if rms_value is None:
        return DB_MIN
    try:
        value = float(rms_value)
    except (TypeError, ValueError):
        return DB_MIN
    if not math.isfinite(value) or value <= 0.0:
        return DB_MIN
    db = 20.0 * math.log10(value) + DB_OFFSET
    return max(DB_MIN, min(DB_MAX, db))