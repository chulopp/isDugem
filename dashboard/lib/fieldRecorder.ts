import { getSimulatedTimestampMs } from "./mockData";
import { haversineDistanceM, POI_SPOTS } from "./mqttTopics";
import { AlertStatus, PoiSpot, TimeLabel, TimeMode } from "./types";

export const LABELS: readonly AlertStatus[] = [
  "SEDANG_KULIAH",
  "ALERT_BOLOS_KULIAH",
  "WARNING_BELUM_KE_MASJID",
  "ISTIRAHAT_DI_KOS",
  "CRITICAL_TERDETEKSI_DI_BAR",
  "ANOMALY_FAKE_GPS",
  "NORMAL",
] as const;

// harus sama dengan server/config.py DEFAULT_POI
export const SERVER_POI: readonly PoiSpot[] = [
  {
    id: "server_kampus",
    name: "Kampus (Server Default)",
    category: "kampus",
    area: "Tembalang",
    lat: -7.0502,
    lon: 110.4398,
    radius_m: 150,
    color: "#2563EB",
  },
  {
    id: "server_masjid",
    name: "Masjid (Server Default)",
    category: "masjid",
    area: "Tembalang",
    lat: -7.0552,
    lon: 110.437,
    radius_m: 100,
    color: "#10B981",
  },
  {
    id: "server_kos",
    name: "Kos (Server Default)",
    category: "kos",
    area: "Tembalang",
    lat: -7.0632,
    lon: 110.4385,
    radius_m: 750,
    color: "#6366F1",
  },
  {
    id: "server_bar",
    name: "Bar (Server Default)",
    category: "bar",
    area: "Semarang Bawah",
    lat: -6.966984,
    lon: 110.429807,
    radius_m: 250,
    color: "#E11D48",
  },
] as const;

export type LabelEnum = (typeof LABELS)[number];
export type TimeSource = "real" | "simulated";
export type LabelType = "real" | "simulated";
export type AudioMode = "default" | "raw";

export interface AudioSettingsSnapshot {
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
}

export interface Sample {
  timestamp_ms: number;
  local_time: string;
  time_source: TimeSource;
  lat: number;
  lon: number;
  accuracy_m: number;
  rms: number;
  db: number;
  speed_mps: number;
  label: LabelEnum;
  label_type: LabelType;
  note: string;
  consistency_warnings: string[];
  device?: string;
  location_source?: string;
  speed_native_mps?: number | null;
  recorded_at_ms?: number;
  accel_magnitude?: number;
  audio_mode?: AudioMode;
  audio_settings?: AudioSettingsSnapshot;
}

export interface RecordingMeta {
  recorded_by: "wendi";
  device: string;
  version: 1;
}

export interface RecordingFile {
  meta: RecordingMeta;
  samples: Sample[];
}

export interface SensorSnapshotInput {
  lat: number;
  lon: number;
  accuracy_m: number;
  db: number;
  accel_magnitude: number;
  lockedSpotId: string;
  timeMode: TimeMode;
  seq: number;
  nowMs: number;
  speed_mps: number;
  speed_native_mps: number | null;
  audio_mode?: AudioMode;
  audio_settings?: AudioSettingsSnapshot | null;
}

export interface BuildSampleOptions {
  label: LabelEnum;
  label_type: LabelType;
  note: string;
  device?: string;
}

/**
 * Helper bersama untuk menentukan `sent_at_ms` / `timestamp_ms` agar nilai yang dikirim
 * lewat publishTelemetryNow() dan nilai yang direkam oleh buildSample() selalu identik.
 */
export function resolveTelemetryTimestampMs(
  timeMode: TimeMode,
  seq: number,
  nowMs: number = Date.now()
): number {
  if (timeMode !== "auto") {
    return getSimulatedTimestampMs(timeMode, seq);
  }
  return nowMs;
}

/**
 * Helper bersama untuk menentukan `speed_mps` yang dikirim ke MQTT dan direkam ke sampel
 * (0 saat koordinat dikunci ke POI demo).
 */
export function resolveEffectiveSpeedMps(
  lockedSpotId: string,
  trackerSpeedMps: number
): number {
  if (lockedSpotId !== "gps_asli") {
    return 0;
  }
  if (!Number.isFinite(trackerSpeedMps) || trackerSpeedMps < 0) {
    return 0;
  }
  return Math.round(Math.min(60, trackerSpeedMps) * 100) / 100;
}

/**
 * Menghitung RMS konsisten dari nilai dB dengan rumus yang sama persis seperti payload MQTT.
 */
export function computeConsistentRms(db: number): number {
  return Number(Math.pow(10, (db - 100) / 20).toFixed(6));
}

/**
 * Mengubah timestamp_ms menjadi string "HH:MM" dalam zona waktu Asia/Jakarta (WIB).
 */
export function formatJakartaLocalTime(timestampMs: number): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestampMs));

  const hhRaw = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mmRaw = parts.find((p) => p.type === "minute")?.value ?? "00";
  const hh = hhRaw === "24" ? "00" : hhRaw.padStart(2, "0");
  const mm = mmRaw.padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseHhMmToMinutes(localTime: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(localTime.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/**
 * Menurunkan `time_label` dari `local_time` ("HH:MM") dengan jendela & urutan prioritas
 * yang sama persis dengan `get_time_label` di `server/processing/decision_engine.py`
 * dan `server/config.py`:
 *   1. waktu_sholat: 12:00-12:45, 15:15-15:45, 18:00-18:30, 19:15-19:45
 *   2. jam_malam:    22:00-05:00 (melewati tengah malam)
 *   3. jam_kuliah:   08:00-15:00
 *   4. lainnya
 */
export function deriveTimeLabelFromLocalTime(localTime: string): TimeLabel {
  const mins = parseHhMmToMinutes(localTime);
  if (mins === null) return "lainnya";

  const inSholat =
    (mins >= 12 * 60 && mins < 12 * 60 + 45) ||
    (mins >= 15 * 60 + 15 && mins < 15 * 60 + 45) ||
    (mins >= 18 * 60 && mins < 18 * 60 + 30) ||
    (mins >= 19 * 60 + 15 && mins < 19 * 60 + 45);
  if (inSholat) {
    return "waktu_sholat";
  }

  if (mins >= 22 * 60 || mins < 5 * 60) {
    return "jam_malam";
  }

  if (mins >= 8 * 60 && mins < 15 * 60) {
    return "jam_kuliah";
  }

  return "lainnya";
}

export function buildSample(
  snapshot: SensorSnapshotInput,
  options: BuildSampleOptions
): Sample {
  const timestamp_ms = resolveTelemetryTimestampMs(
    snapshot.timeMode,
    snapshot.seq,
    snapshot.nowMs
  );
  const local_time = formatJakartaLocalTime(timestamp_ms);
  const time_source: TimeSource =
    snapshot.timeMode !== "auto" ? "simulated" : "real";
  const rms = computeConsistentRms(snapshot.db);
  const speed_mps = resolveEffectiveSpeedMps(
    snapshot.lockedSpotId,
    snapshot.speed_mps
  );
  const location_source =
    snapshot.lockedSpotId === "gps_asli"
      ? "gps_asli"
      : `locked:${snapshot.lockedSpotId}`;
  const effectiveLabelType: LabelType =
    location_source !== "gps_asli" ? "simulated" : options.label_type;

  const cleanNote = (options.note || "").slice(0, 120);
  const consistency_warnings = checkConsistency({
    local_time,
    lat: snapshot.lat,
    lon: snapshot.lon,
    db: snapshot.db,
    label: options.label,
  });

  const sample: Sample = {
    timestamp_ms,
    local_time,
    time_source,
    lat: snapshot.lat,
    lon: snapshot.lon,
    accuracy_m: snapshot.accuracy_m,
    rms,
    db: snapshot.db,
    speed_mps,
    label: options.label,
    label_type: effectiveLabelType,
    note: cleanNote,
    consistency_warnings,
    location_source,
    speed_native_mps:
      snapshot.speed_native_mps !== undefined &&
      snapshot.speed_native_mps !== null &&
      Number.isFinite(snapshot.speed_native_mps)
        ? Number(snapshot.speed_native_mps.toFixed(2))
        : null,
    recorded_at_ms: snapshot.nowMs,
    accel_magnitude: snapshot.accel_magnitude,
    audio_mode: snapshot.audio_mode === "raw" ? "raw" : "default",
    audio_settings: {
      echoCancellation:
        typeof snapshot.audio_settings?.echoCancellation === "boolean"
          ? snapshot.audio_settings.echoCancellation
          : null,
      noiseSuppression:
        typeof snapshot.audio_settings?.noiseSuppression === "boolean"
          ? snapshot.audio_settings.noiseSuppression
          : null,
      autoGainControl:
        typeof snapshot.audio_settings?.autoGainControl === "boolean"
          ? snapshot.audio_settings.autoGainControl
          : null,
    },
  };

  if (options.device) {
    sample.device = options.device;
  }

  return sample;
}

export function buildFile(
  meta: { device: string; recorded_by?: "wendi"; version?: 1 },
  samples: Sample[]
): RecordingFile {
  return {
    meta: {
      recorded_by: "wendi",
      device: meta.device.trim() || "Unknown Device",
      version: 1,
    },
    samples,
  };
}

export function toFilename(
  device: string,
  nowMs: number = Date.now()
): string {
  const slug =
    device
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "device";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(nowMs));

  const yyyy = parts.find((p) => p.type === "year")?.value ?? "2026";
  const mm = parts.find((p) => p.type === "month")?.value ?? "01";
  const dd = parts.find((p) => p.type === "day")?.value ?? "01";
  const rawHh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const hh = rawHh === "24" ? "00" : rawHh.padStart(2, "0");
  const min = (parts.find((p) => p.type === "minute")?.value ?? "00").padStart(
    2,
    "0"
  );

  return `real_field_samples_${slug}_${yyyy}${mm}${dd}-${hh}${min}.json`;
}

export interface CategoryGeometrySummary {
  kampus: { distM: number; radiusM: number; inside: boolean; nearestSpotName: string };
  masjid: { distM: number; radiusM: number; inside: boolean; nearestSpotName: string };
  kos: { distM: number; radiusM: number; inside: boolean; nearestSpotName: string };
  bar: { distM: number; radiusM: number; inside: boolean; nearestSpotName: string };
}

export function computePoiCategorySummary(
  lat: number,
  lon: number,
  poiSpots: readonly PoiSpot[] = SERVER_POI
): CategoryGeometrySummary {
  const res: CategoryGeometrySummary = {
    kampus: { distM: Infinity, radiusM: 150, inside: false, nearestSpotName: "Kampus" },
    masjid: { distM: Infinity, radiusM: 100, inside: false, nearestSpotName: "Masjid" },
    kos: { distM: Infinity, radiusM: 750, inside: false, nearestSpotName: "Kos" },
    bar: { distM: Infinity, radiusM: 250, inside: false, nearestSpotName: "Bar" },
  };

  for (const spot of poiSpots) {
    const d = haversineDistanceM(lat, lon, spot.lat, spot.lon);
    const cat = spot.category;
    if (d < res[cat].distM) {
      res[cat].distM = d;
      res[cat].radiusM = spot.radius_m;
      res[cat].nearestSpotName = spot.name;
    }
    if (d <= spot.radius_m) {
      res[cat].inside = true;
    }
  }

  return res;
}

/**
 * Memeriksa konsistensi antara `label` yang dipilih dengan jam (`local_time`),
 * geometri jarak ke `poiSpots`, dan tingkat kebisingan (`db`).
 * Mengembalikan daftar string peringatan (tidak memblokir perekaman).
 */
export function checkConsistency(
  sample: Pick<Sample, "local_time" | "lat" | "lon" | "db" | "label">,
  poiSpots: readonly PoiSpot[] = SERVER_POI
): string[] {
  const warnings: string[] = [];
  const timeLabel = deriveTimeLabelFromLocalTime(sample.local_time);
  const geo = computePoiCategorySummary(sample.lat, sample.lon, poiSpots);
  const { label, db, local_time } = sample;

  // 1. Cek Label vs Jam (mengikuti prioritas get_time_label di server/processing/decision_engine.py)
  if (label === "SEDANG_KULIAH" || label === "ALERT_BOLOS_KULIAH") {
    if (timeLabel !== "jam_kuliah") {
      const extra =
        timeLabel === "waktu_sholat"
          ? " (jam ini masuk jendela waktu_sholat yang berprioritas lebih tinggi dari jam_kuliah)"
          : "";
      warnings.push(
        `Label ${label} butuh jam_kuliah (08:00-15:00 di luar waktu sholat), tetapi jam ${local_time} adalah ${timeLabel}${extra}.`
      );
    }
  } else if (label === "WARNING_BELUM_KE_MASJID") {
    if (timeLabel !== "waktu_sholat") {
      warnings.push(
        `Label ${label} butuh waktu_sholat (12:00-12:45, 15:15-15:45, 18:00-18:30, 19:15-19:45), tetapi jam ${local_time} adalah ${timeLabel}.`
      );
    }
  } else if (
    label === "ISTIRAHAT_DI_KOS" ||
    label === "CRITICAL_TERDETEKSI_DI_BAR" ||
    label === "ANOMALY_FAKE_GPS"
  ) {
    if (timeLabel !== "jam_malam") {
      warnings.push(
        `Label ${label} butuh jam_malam (22:00-05:00), tetapi jam ${local_time} adalah ${timeLabel}.`
      );
    }
  }

  // 2. Cek Label vs Geometri POI
  if (label === "ISTIRAHAT_DI_KOS" || label === "ANOMALY_FAKE_GPS") {
    if (!geo.kos.inside) {
      warnings.push(
        `Label ${label} butuh jarak ke kos <= ${geo.kos.radiusM} m, saat ini ${Math.round(
          geo.kos.distM
        )} m.`
      );
    }
  } else if (label === "CRITICAL_TERDETEKSI_DI_BAR") {
    if (!geo.bar.inside) {
      warnings.push(
        `Label ${label} butuh jarak ke bar <= ${geo.bar.radiusM} m, saat ini ${Math.round(
          geo.bar.distM
        )} m.`
      );
    }
  } else if (label === "SEDANG_KULIAH") {
    if (!geo.kampus.inside) {
      warnings.push(
        `Label ${label} butuh jarak ke kampus <= ${geo.kampus.radiusM} m, saat ini ${Math.round(
          geo.kampus.distM
        )} m.`
      );
    }
  } else if (label === "ALERT_BOLOS_KULIAH") {
    if (geo.kampus.inside) {
      warnings.push(
        `Label ${label} butuh jarak ke kampus > ${geo.kampus.radiusM} m, saat ini ${Math.round(
          geo.kampus.distM
        )} m (di dalam kampus).`
      );
    }
  } else if (label === "WARNING_BELUM_KE_MASJID") {
    if (geo.masjid.inside) {
      warnings.push(
        `Label ${label} butuh jarak ke masjid > ${geo.masjid.radiusM} m, saat ini ${Math.round(
          geo.masjid.distM
        )} m (sudah di masjid).`
      );
    }
  }

  // 3. Cek Label vs dB
  if (label === "ISTIRAHAT_DI_KOS" && !(db < 55)) {
    warnings.push(
      `Label ISTIRAHAT_DI_KOS butuh dB < 55, saat ini ${db.toFixed(1)} dB.`
    );
  } else if (label === "CRITICAL_TERDETEKSI_DI_BAR" && !(db > 75)) {
    warnings.push(
      `Label CRITICAL_TERDETEKSI_DI_BAR butuh dB > 75, saat ini ${db.toFixed(
        1
      )} dB.`
    );
  } else if (label === "ANOMALY_FAKE_GPS" && !(db > 80)) {
    warnings.push(
      `Label ANOMALY_FAKE_GPS butuh dB > 80, saat ini ${db.toFixed(1)} dB.`
    );
  } else if (label === "SEDANG_KULIAH" && !(db < 65)) {
    warnings.push(
      `Label SEDANG_KULIAH butuh dB < 65, saat ini ${db.toFixed(1)} dB.`
    );
  }

  return warnings;
}

