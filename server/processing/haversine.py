from __future__ import annotations
from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_M = 6_371_000.0

def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = radians(lat1), radians(lat2)
    d_phi = radians(lat2 - lat1)
    d_lambda = radians(lon2 - lon1)

    a = sin(d_phi / 2.0) ** 2 + cos(phi1) * cos(phi2) * sin(d_lambda / 2.0) ** 2
    a = min(1.0, max(0.0, a))
    return 2.0 * EARTH_RADIUS_M * asin(sqrt(a))