import math

import pytest

from processing.haversine import EARTH_RADIUS_M, haversine_distance_m

# Titik POI default (docs/mqtt-schema.md bagian 4)
KAMPUS = (-6.9915, 110.4210)
MASJID = (-6.9930, 110.4195)
KOS = (-6.9940, 110.4225)
BAR = (-6.9960, 110.4240)


def test_same_point_is_zero():
    assert haversine_distance_m(*KAMPUS, *KAMPUS) == 0.0


def test_one_degree_latitude_matches_arc_length():
    # 1 derajat lintang = R * pi / 180 ~= 111_194.93 m
    expected = EARTH_RADIUS_M * math.pi / 180.0
    assert haversine_distance_m(0.0, 0.0, 1.0, 0.0) == pytest.approx(expected, rel=1e-9)


def test_symmetry():
    d1 = haversine_distance_m(*KOS, *BAR)
    d2 = haversine_distance_m(*BAR, *KOS)
    assert d1 == pytest.approx(d2, rel=1e-12)


def test_antipodal_points_are_half_circumference():
    expected = math.pi * EARTH_RADIUS_M
    assert haversine_distance_m(0.0, 0.0, 0.0, 180.0) == pytest.approx(expected, rel=1e-9)


def test_cross_check_against_equirectangular_for_short_distance():
    # Cross-check independen: aproksimasi equirectangular akurat untuk jarak pendek.
    lat1, lon1 = KAMPUS
    lat2, lon2 = MASJID
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    approx = EARTH_RADIUS_M * math.hypot(x, y)
    assert haversine_distance_m(lat1, lon1, lat2, lon2) == pytest.approx(approx, rel=1e-4)


def test_geofence_kos_dan_bar_tidak_tumpang_tindih():
    # Keduanya dievaluasi pada time_label yang sama (jam_malam); jika tumpang tindih,
    # satu titik bisa memenuhi dua aturan sekaligus. Jarak kos-bar harus > 50 + 100 m.
    assert haversine_distance_m(*KOS, *BAR) > 50 + 100


def test_kampus_dan_masjid_default_sedikit_tumpang_tindih_tapi_aman():
    # Jarak ~235 m < 150 + 100 m: lingkaran di peta saling beririsan ~15 m. Aman untuk logika
    # karena kampus (jam_kuliah) dan masjid (waktu_sholat) tidak pernah dievaluasi bersamaan.
    d = haversine_distance_m(*KAMPUS, *MASJID)
    assert 234.0 < d < 236.0
    assert d < 150 + 100


def test_known_short_distance_about_111m_per_millidegree():
    assert haversine_distance_m(-6.0, 110.0, -6.001, 110.0) == pytest.approx(111.19, abs=0.05)