"""
Unit tests for Haversine distance formula.
"""

import math
import pytest
from server.processing.haversine import haversine_distance_m


def test_haversine_same_point():
    lat = -6.9915
    lon = 110.4210
    assert haversine_distance_m(lat, lon, lat, lon) == 0.0


def test_haversine_symmetry():
    p1 = (-6.9915, 110.4210)
    p2 = (-6.9940, 110.4225)
    d1 = haversine_distance_m(p1[0], p1[1], p2[0], p2[1])
    d2 = haversine_distance_m(p2[0], p2[1], p1[0], p1[1])
    assert math.isclose(d1, d2, rel_tol=1e-5)
    assert d1 > 0


def test_haversine_approximate_distance():
    # Jarak antara dua titik Semarang ~ 300 meter
    lat1, lon1 = -6.9915, 110.4210
    lat2, lon2 = -6.9940, 110.4225
    dist = haversine_distance_m(lat1, lon1, lat2, lon2)
    assert 200 < dist < 400
