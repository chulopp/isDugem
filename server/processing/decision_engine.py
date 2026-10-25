"""
Decision Engine classifier for RantauGuard.
Evaluates Context against the rule-based Decision Table (PRD Section 8.5).
"""

from ..models import Context, AlertStatus


def classify(ctx: Context) -> AlertStatus:
    """
    Classify the current context into an AlertStatus enum based on the decision table.
    
    Priority Rule: ANOMALY_FAKE_GPS must be evaluated before ISTIRAHAT_DI_KOS
    when time_label == 'jam_malam'.
    """
    # 1. Evaluasi kondisi Jam Malam
    if ctx.time_label == "jam_malam":
        # Prioritas 1: Anomali Fake GPS (klaim di kos tapi suara sangat keras > 80 dB)
        if ctx.claimed_at_kos and ctx.db_level > 80.0:
            return AlertStatus.ANOMALY_FAKE_GPS

        # Prioritas 2: Terdeteksi di Bar (> 75 dB dan dekat bar <= 100m)
        if ctx.distance_bar_m <= 100.0 and ctx.db_level > 75.0:
            return AlertStatus.CRITICAL_TERDETEKSI_DI_BAR

        # Prioritas 3: Istirahat di Kos tenang (<= 50m kos dan tenang < 55 dB)
        if ctx.distance_kos_m <= 50.0 and ctx.db_level < 55.0:
            return AlertStatus.ISTIRAHAT_DI_KOS

    # 2. Evaluasi kondisi Jam Kuliah
    elif ctx.time_label == "jam_kuliah":
        if ctx.distance_kampus_m <= 150.0 and ctx.db_level < 65.0:
            return AlertStatus.SEDANG_KULIAH
        elif ctx.distance_kampus_m > 150.0:
            return AlertStatus.ALERT_BOLOS_KULIAH

    # 3. Evaluasi kondisi Waktu Sholat
    elif ctx.time_label == "waktu_sholat":
        if ctx.distance_masjid_m > 100.0:
            return AlertStatus.WARNING_BELUM_KE_MASJID

    # 4. Default / Kondisi normal lainnya
    return AlertStatus.NORMAL
