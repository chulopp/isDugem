"""
Unit tests for the rule-based Decision Engine classifier.
Verifies all rows in PRD Section 8.5 Decision Table.
"""

import pytest
from server.models import Context, AlertStatus
from server.processing.decision_engine import classify


def test_sedang_kuliah():
    ctx = Context(
        time_label="jam_kuliah",
        distance_kampus_m=50.0,
        distance_masjid_m=300.0,
        distance_kos_m=400.0,
        distance_bar_m=800.0,
        db_level=55.0,
        claimed_at_kos=False,
    )
    assert classify(ctx) == AlertStatus.SEDANG_KULIAH


def test_alert_bolos_kuliah():
    ctx = Context(
        time_label="jam_kuliah",
        distance_kampus_m=350.0,  # > 150m
        distance_masjid_m=200.0,
        distance_kos_m=100.0,
        distance_bar_m=600.0,
        db_level=50.0,
        claimed_at_kos=False,
    )
    assert classify(ctx) == AlertStatus.ALERT_BOLOS_KULIAH


def test_warning_belum_ke_masjid():
    ctx = Context(
        time_label="waktu_sholat",
        distance_kampus_m=300.0,
        distance_masjid_m=250.0,  # > 100m
        distance_kos_m=200.0,
        distance_bar_m=500.0,
        db_level=45.0,
        claimed_at_kos=False,
    )
    assert classify(ctx) == AlertStatus.WARNING_BELUM_KE_MASJID


def test_istirahat_di_kos():
    ctx = Context(
        time_label="jam_malam",
        distance_kampus_m=400.0,
        distance_masjid_m=300.0,
        distance_kos_m=30.0,  # <= 50m
        distance_bar_m=500.0,
        db_level=42.0,  # < 55 dB
        claimed_at_kos=True,
    )
    assert classify(ctx) == AlertStatus.ISTIRAHAT_DI_KOS


def test_critical_terdeteksi_di_bar():
    ctx = Context(
        time_label="jam_malam",
        distance_kampus_m=700.0,
        distance_masjid_m=600.0,
        distance_kos_m=400.0,
        distance_bar_m=45.0,  # <= 100m
        db_level=85.0,  # > 75 dB
        claimed_at_kos=False,
    )
    assert classify(ctx) == AlertStatus.CRITICAL_TERDETEKSI_DI_BAR


def test_anomaly_fake_gps_priority():
    # Fitur pembeda: Lokasi klaim di kamar kos (<= 50m), tapi suara musik/bar > 80 dB!
    ctx = Context(
        time_label="jam_malam",
        distance_kampus_m=500.0,
        distance_masjid_m=400.0,
        distance_kos_m=20.0,  # di dalam kos!
        distance_bar_m=300.0,
        db_level=88.5,  # sangat berisik > 80 dB!
        claimed_at_kos=True,
    )
    # Harus dideteksi sebagai ANOMALY_FAKE_GPS, bukan ISTIRAHAT_DI_KOS
    assert classify(ctx) == AlertStatus.ANOMALY_FAKE_GPS


def test_kondisi_normal():
    ctx = Context(
        time_label="lainnya",
        distance_kampus_m=200.0,
        distance_masjid_m=200.0,
        distance_kos_m=200.0,
        distance_bar_m=500.0,
        db_level=60.0,
        claimed_at_kos=False,
    )
    assert classify(ctx) == AlertStatus.NORMAL
