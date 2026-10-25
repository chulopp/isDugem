from datetime import time

import pytest

from config import rangeTime
from models import ALL_STATUSES, Status
from processing.decision_engine import (
    JAM_KULIAH,
    JAM_MALAM,
    LAINNYA,
    WAKTU_SHOLAT,
    Context,
    build_reason,
    classify,
    get_time_label,
    nearest_poi,
)

FAR = 5000.0


def ctx(time_label, kampus=FAR, masjid=FAR, kos=FAR, bar=FAR, db=40.0, claimed=None):
    if claimed is None:
        claimed = kos <= 50
    return Context(time_label, kampus, masjid, kos, bar, db, claimed)


# ------------------------------ jam_kuliah ------------------------------
def test_sedang_kuliah_di_kampus_tenang():
    assert classify(ctx(JAM_KULIAH, kampus=100, db=50)) == Status.SEDANG_KULIAH


def test_kuliah_boundary_exactly_150m_is_inside():
    assert classify(ctx(JAM_KULIAH, kampus=150.0, db=50)) == Status.SEDANG_KULIAH


def test_kuliah_boundary_db_65_is_not_quiet():
    # tabel: SEDANG_KULIAH hanya jika dB < 65 -> tepat 65 jatuh ke NORMAL
    assert classify(ctx(JAM_KULIAH, kampus=10, db=65.0)) == Status.NORMAL


def test_bolos_jika_jauh_dari_kampus_walau_senyap():
    assert classify(ctx(JAM_KULIAH, kampus=150.1, db=10)) == Status.ALERT_BOLOS_KULIAH


def test_bolos_tidak_peduli_db():
    assert classify(ctx(JAM_KULIAH, kampus=800, db=95)) == Status.ALERT_BOLOS_KULIAH


# ----------------------------- waktu_sholat -----------------------------
def test_warning_belum_ke_masjid():
    assert classify(ctx(WAKTU_SHOLAT, masjid=100.1)) == Status.WARNING_BELUM_KE_MASJID


def test_sholat_di_masjid_normal():
    assert classify(ctx(WAKTU_SHOLAT, masjid=100.0)) == Status.NORMAL


# ------------------------------- jam_malam ------------------------------
def test_anomaly_fake_gps_kos_tapi_dentuman():
    assert classify(ctx(JAM_MALAM, kos=10, db=81.3)) == Status.ANOMALY_FAKE_GPS


def test_anomaly_menang_atas_istirahat_dan_bar_prioritas_tinggi():
    # dB tinggi + klaim di kos: harus ANOMALY, bukan ISTIRAHAT/NORMAL
    assert classify(ctx(JAM_MALAM, kos=0, db=100)) == Status.ANOMALY_FAKE_GPS


def test_anomaly_boundary_db_80_bukan_anomaly():
    assert classify(ctx(JAM_MALAM, kos=10, db=80.0)) == Status.NORMAL


def test_istirahat_di_kos_tenang():
    assert classify(ctx(JAM_MALAM, kos=20, db=40)) == Status.ISTIRAHAT_DI_KOS


def test_istirahat_boundary_db_55_bukan_istirahat():
    assert classify(ctx(JAM_MALAM, kos=20, db=55.0)) == Status.NORMAL


def test_kos_db_di_antara_55_dan_80_normal():
    assert classify(ctx(JAM_MALAM, kos=20, db=70)) == Status.NORMAL


def test_critical_di_bar():
    assert classify(ctx(JAM_MALAM, bar=42, db=81.3)) == Status.CRITICAL_TERDETEKSI_DI_BAR


def test_bar_boundary_db_75_bukan_critical():
    assert classify(ctx(JAM_MALAM, bar=42, db=75.0)) == Status.NORMAL


def test_bar_terlalu_jauh_normal():
    assert classify(ctx(JAM_MALAM, bar=100.1, db=90)) == Status.NORMAL


def test_malam_dimana_saja_senyap_normal():
    assert classify(ctx(JAM_MALAM, db=30)) == Status.NORMAL


def test_lainnya_selalu_normal():
    assert classify(ctx(LAINNYA, kampus=10, kos=10, bar=10, db=99)) == Status.NORMAL


def test_custom_radii_dipakai():
    c = ctx(JAM_KULIAH, kampus=200, db=40)
    assert classify(c) == Status.ALERT_BOLOS_KULIAH
    assert classify(c, radii={"kampus": 250}) == Status.SEDANG_KULIAH


def test_classify_selalu_mengembalikan_enum_kontrak():
    for label in (JAM_KULIAH, WAKTU_SHOLAT, JAM_MALAM, LAINNYA):
        for d in (0, 60, 120, 500):
            for db in (0, 50, 60, 70, 78, 90):
                c = ctx(label, kampus=d, masjid=d, kos=d, bar=d, db=db)
                assert classify(c) in ALL_STATUSES


# ------------------------------ time_label ------------------------------
KULIAH = rangeTime(time(8, 0), time(15, 0))
SHOLAT = (rangeTime(time(12, 0), time(12, 45)),)
MALAM = rangeTime(time(22, 0), time(5, 0))


@pytest.mark.parametrize(
    "t, expected",
    [
        (time(9, 0), JAM_KULIAH),
        (time(12, 0), WAKTU_SHOLAT),    # sholat menang atas kuliah
        (time(12, 44), WAKTU_SHOLAT),
        (time(12, 45), JAM_KULIAH),     # batas akhir eksklusif
        (time(15, 0), LAINNYA),
        (time(18, 0), LAINNYA),
        (time(22, 0), JAM_MALAM),
        (time(23, 30), JAM_MALAM),
        (time(0, 0), JAM_MALAM),        # melewati tengah malam
        (time(4, 59), JAM_MALAM),
        (time(5, 0), LAINNYA),
    ],
)
def test_get_time_label(t, expected):
    assert get_time_label(t, KULIAH, SHOLAT, MALAM) == expected


# ------------------------------ util lain -------------------------------
def test_nearest_poi_picks_smallest_distance():
    name, dist = nearest_poi(ctx(JAM_MALAM, kampus=300, masjid=200, kos=90, bar=42))
    assert (name, dist) == ("bar", 42)


def test_build_reason_bar_mengikuti_format_skema():
    c = ctx(JAM_MALAM, bar=42, db=81.3)
    assert build_reason(Status.CRITICAL_TERDETEKSI_DI_BAR, c, "23:10") == (
        "Jarak ke bar 42m, suara 81.3 dB pada jam 23:10"
    )


@pytest.mark.parametrize("status", ALL_STATUSES)
def test_build_reason_tidak_kosong_untuk_semua_status(status):
    assert build_reason(status, ctx(JAM_MALAM, kos=10, db=60), "23:10").strip() != ""
