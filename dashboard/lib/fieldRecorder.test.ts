import { describe, expect, it } from "vitest";
import {
  buildFile,
  buildSample,
  checkConsistency,
  computeConsistentRms,
  computePoiCategorySummary,
  deriveTimeLabelFromLocalTime,
  formatJakartaLocalTime,
  LABELS,
  SERVER_POI,
  toFilename,
} from "./fieldRecorder";
import { POI_SPOTS } from "./mqttTopics";

describe("fieldRecorder", () => {
  it("memiliki tepat 7 enum LABELS sesuai kontrak server", () => {
    expect(LABELS).toEqual([
      "SEDANG_KULIAH",
      "ALERT_BOLOS_KULIAH",
      "WARNING_BELUM_KE_MASJID",
      "ISTIRAHAT_DI_KOS",
      "CRITICAL_TERDETEKSI_DI_BAR",
      "ANOMALY_FAKE_GPS",
      "NORMAL",
    ]);
  });

  it("formatJakartaLocalTime menghasilkan HH:MM di zona Asia/Jakarta (termasuk lewat tengah malam)", () => {
    // 2026-11-01T16:10:00Z = 23:10 WIB (UTC+7)
    const ts2310 = Date.parse("2026-11-01T16:10:00Z");
    expect(formatJakartaLocalTime(ts2310)).toBe("23:10");

    // 2026-11-01T17:05:00Z = 00:05 WIB hari berikutnya (lewat tengah malam)
    const ts0005 = Date.parse("2026-11-01T17:05:00Z");
    expect(formatJakartaLocalTime(ts0005)).toBe("00:05");

    // 2026-11-01T05:15:00Z = 12:15 WIB
    const ts1215 = Date.parse("2026-11-01T05:15:00Z");
    expect(formatJakartaLocalTime(ts1215)).toBe("12:15");
  });

  it("deriveTimeLabelFromLocalTime mengikuti prioritas server (waktu_sholat > jam_malam > jam_kuliah > lainnya)", () => {
    // 12:15 berada di dalam 08:00-15:00 tetapi harus diprioritaskan sebagai waktu_sholat
    expect(deriveTimeLabelFromLocalTime("12:15")).toBe("waktu_sholat");
    expect(deriveTimeLabelFromLocalTime("15:30")).toBe("waktu_sholat");
    expect(deriveTimeLabelFromLocalTime("18:10")).toBe("waktu_sholat");
    expect(deriveTimeLabelFromLocalTime("19:30")).toBe("waktu_sholat");

    // Jam kuliah di luar waktu sholat
    expect(deriveTimeLabelFromLocalTime("09:00")).toBe("jam_kuliah");
    expect(deriveTimeLabelFromLocalTime("12:45")).toBe("jam_kuliah");

    // Jam malam melewati tengah malam (22:00-05:00)
    expect(deriveTimeLabelFromLocalTime("22:00")).toBe("jam_malam");
    expect(deriveTimeLabelFromLocalTime("00:30")).toBe("jam_malam");
    expect(deriveTimeLabelFromLocalTime("04:59")).toBe("jam_malam");
    expect(deriveTimeLabelFromLocalTime("05:00")).toBe("lainnya");
    expect(deriveTimeLabelFromLocalTime("16:30")).toBe("lainnya");
  });

  it("buildSample membangun sampel dengan rms, speed_mps, time_source, dan field aditif yang konsisten", () => {
    const nowMs = Date.parse("2026-11-01T16:10:00Z"); // 23:10 WIB
    const sampleReal = buildSample(
      {
        lat: -7.067588,
        lon: 110.439708,
        accuracy_m: 8.5,
        db: 46.7,
        accel_magnitude: 9.8,
        lockedSpotId: "gps_asli",
        timeMode: "auto",
        seq: 10,
        nowMs,
        speed_mps: 1.35,
        speed_native_mps: 1.412,
      },
      {
        label: "ISTIRAHAT_DI_KOS",
        label_type: "real",
        note: "kamar kos, tenang",
        device: "Realme 9 Pro",
      }
    );

    expect(sampleReal).toEqual({
      timestamp_ms: nowMs,
      local_time: "23:10",
      time_source: "real",
      lat: -7.067588,
      lon: 110.439708,
      accuracy_m: 8.5,
      rms: computeConsistentRms(46.7),
      db: 46.7,
      speed_mps: 1.35,
      label: "ISTIRAHAT_DI_KOS",
      label_type: "real",
      note: "kamar kos, tenang",
      device: "Realme 9 Pro",
      location_source: "gps_asli",
      speed_native_mps: 1.41,
      recorded_at_ms: nowMs,
      accel_magnitude: 9.8,
    });

    // Saat koordinat dikunci ke POI demo dan waktu disimulasikan: speed_mps harus 0 dan time_source = "simulated"
    const sampleLocked = buildSample(
      {
        lat: -6.968,
        lon: 110.4285,
        accuracy_m: 5.0,
        db: 84.2,
        accel_magnitude: 9.8,
        lockedSpotId: "bar_redhare",
        timeMode: "jam_malam",
        seq: 11,
        nowMs,
        speed_mps: 12.5,
        speed_native_mps: null,
      },
      {
        label: "CRITICAL_TERDETEKSI_DI_BAR",
        label_type: "simulated",
        note: "x".repeat(150),
        device: "Poco X5 Pro 5G",
      }
    );

    expect(sampleLocked.time_source).toBe("simulated");
    expect(sampleLocked.local_time).toMatch(/^23:0[0-3]$/);
    expect(sampleLocked.speed_mps).toBe(0);
    expect(sampleLocked.location_source).toBe("locked:bar_redhare");
    expect(sampleLocked.speed_native_mps).toBeNull();
    expect(sampleLocked.note.length).toBe(120);
  });

  it("buildSample memaksa label_type = 'simulated' bila location_source bukan 'gps_asli' meskipun dipilih 'real'", () => {
    const nowMs = Date.parse("2026-11-01T16:10:00Z");
    const sampleForced = buildSample(
      {
        lat: -7.0632,
        lon: 110.4385,
        accuracy_m: 6.0,
        db: 42.0,
        accel_magnitude: 9.8,
        lockedSpotId: "kos_mulawarman",
        timeMode: "auto",
        seq: 12,
        nowMs,
        speed_mps: 0.4,
        speed_native_mps: 0.3,
      },
      {
        label: "ISTIRAHAT_DI_KOS",
        label_type: "real",
        note: "coba paksa real saat koordinat dikunci",
        device: "Realme 9 Pro",
      }
    );

    expect(sampleForced.location_source).toBe("locked:kos_mulawarman");
    expect(sampleForced.label_type).toBe("simulated");
    expect(sampleForced.speed_mps).toBe(0);
  });

  it("checkConsistency mengembalikan array kosong untuk kasus valid dan daftar peringatan untuk kasus tidak sesuai", () => {
    // 1. Kasus lolos: SEDANG_KULIAH di Kampus UNDIP pada 09:00 dengan dB 52
    expect(
      checkConsistency({
        local_time: "09:00",
        lat: -7.0502,
        lon: 110.4398,
        db: 52.0,
        label: "SEDANG_KULIAH",
      })
    ).toEqual([]);

    // 2. Kasus lolos: ISTIRAHAT_DI_KOS lewat tengah malam (01:15) di Kos Mulawarman dengan dB 42
    expect(
      checkConsistency({
        local_time: "01:15",
        lat: -7.067588,
        lon: 110.439708,
        db: 42.0,
        label: "ISTIRAHAT_DI_KOS",
      })
    ).toEqual([]);

    // 3. Kasus tumpang tindih jam: SEDANG_KULIAH pada 12:15 (masuk waktu_sholat!) harus memberi peringatan
    const warnOverlap = checkConsistency({
      local_time: "12:15",
      lat: -7.0502,
      lon: 110.4398,
      db: 50.0,
      label: "SEDANG_KULIAH",
    });
    expect(warnOverlap.length).toBe(1);
    expect(warnOverlap[0]).toContain("waktu_sholat");

    // 4. Kasus pelanggaran ganda: CRITICAL_TERDETEKSI_DI_BAR tetapi jam 10:00, lokasi di kampus, dan dB 50
    const warnBar = checkConsistency({
      local_time: "10:00",
      lat: -7.0502,
      lon: 110.4398,
      db: 50.0,
      label: "CRITICAL_TERDETEKSI_DI_BAR",
    });
    expect(warnBar.length).toBe(3);

    // 5. Kasus ALERT_BOLOS_KULIAH tetapi masih berada di dalam radius kampus
    const warnBolosInKampus = checkConsistency({
      local_time: "10:00",
      lat: -7.0502,
      lon: 110.4398,
      db: 55.0,
      label: "ALERT_BOLOS_KULIAH",
    });
    expect(warnBolosInKampus.length).toBe(1);
    expect(warnBolosInKampus[0]).toContain("di dalam kampus");
  });

  it("checkConsistency mengikuti titik pusat SERVER_POI (bukan multi-spot POI_SPOTS dashboard)", () => {
    // Titik A (-7.0655, 110.4330): berada dalam 750 m dari pusat kos SERVER_POI (-7.0632, 110.4385; ~659 m),
    // tetapi di luar 750 m dari semua 3 spot kos di POI_SPOTS dashboard (>750 m).
    const latInsideServerOnly = -7.0655;
    const lonInsideServerOnly = 110.433;

    const serverSummaryA = computePoiCategorySummary(
      latInsideServerOnly,
      lonInsideServerOnly,
      SERVER_POI
    );
    const dashboardSummaryA = computePoiCategorySummary(
      latInsideServerOnly,
      lonInsideServerOnly,
      POI_SPOTS
    );
    expect(serverSummaryA.kos.distM).toBeLessThanOrEqual(750);
    expect(serverSummaryA.kos.inside).toBe(true);
    expect(dashboardSummaryA.kos.distM).toBeGreaterThan(750);
    expect(dashboardSummaryA.kos.inside).toBe(false);

    // Dengan SERVER_POI (default), titik A dianggap dalam radius kos (tanpa peringatan lokasi)
    expect(
      checkConsistency({
        local_time: "23:15",
        lat: latInsideServerOnly,
        lon: lonInsideServerOnly,
        db: 42.0,
        label: "ISTIRAHAT_DI_KOS",
      })
    ).toEqual([]);

    // Sebaliknya, Titik B (-7.0720, 110.439708): di luar 750 m dari pusat kos SERVER_POI (~987 m),
    // tetapi di dalam 750 m dari kos_mulawarman di POI_SPOTS dashboard (~490 m).
    const latInsideDashboardOnly = -7.072;
    const lonInsideDashboardOnly = 110.439708;

    const serverSummaryB = computePoiCategorySummary(
      latInsideDashboardOnly,
      lonInsideDashboardOnly,
      SERVER_POI
    );
    const dashboardSummaryB = computePoiCategorySummary(
      latInsideDashboardOnly,
      lonInsideDashboardOnly,
      POI_SPOTS
    );
    expect(serverSummaryB.kos.distM).toBeGreaterThan(750);
    expect(serverSummaryB.kos.inside).toBe(false);
    expect(dashboardSummaryB.kos.distM).toBeLessThanOrEqual(750);
    expect(dashboardSummaryB.kos.inside).toBe(true);

    // Dengan SERVER_POI (default), titik B dianggap di luar radius kos (menghasilkan peringatan lokasi)
    const warningsB = checkConsistency({
      local_time: "23:15",
      lat: latInsideDashboardOnly,
      lon: lonInsideDashboardOnly,
      db: 42.0,
      label: "ISTIRAHAT_DI_KOS",
    });
    expect(warningsB.length).toBe(1);
    expect(warningsB[0]).toContain("jarak ke kos <= 750 m");
  });

  it("toFilename dan buildFile menghasilkan nama dan struktur file yang benar", () => {
    const ts = Date.parse("2026-11-01T16:10:00Z"); // 2026-11-01 23:10 WIB
    expect(toFilename("Poco X5 Pro 5G", ts)).toBe(
      "real_field_samples_poco-x5-pro-5g_20261101-2310.json"
    );

    const file = buildFile({ device: "Realme 9 Pro" }, []);
    expect(file).toEqual({
      meta: {
        recorded_by: "wendi",
        device: "Realme 9 Pro",
        version: 1,
      },
      samples: [],
    });
  });
});

