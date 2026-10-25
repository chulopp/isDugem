import { Alert, AlertStatus, PoiSpot, TimeLabel } from "./types";

export const PROJECT_ID =
  process.env.NEXT_PUBLIC_PROJECT_ID || "isdugem_tim_01";

export const MQTT_WSS_URL =
  process.env.NEXT_PUBLIC_MQTT_WSS_URL || "wss://broker.hivemq.com:8884/mqtt";

export const MQTT_TOPICS = {
  ANAK_TELEMETRY: `rantauguard/${PROJECT_ID}/edge/anak/telemetry`,
  ORTU_TELEMETRY: `rantauguard/${PROJECT_ID}/edge/ortu/telemetry`,
  ALL_TELEMETRY: `rantauguard/${PROJECT_ID}/edge/+/telemetry`,
  ALERTS: `rantauguard/${PROJECT_ID}/alerts`,
  COMMAND_PING: `rantauguard/${PROJECT_ID}/command/ping`,
  COMMAND_ALARM: `rantauguard/${PROJECT_ID}/command/alarm`,
  COMMAND_REMINDER: `rantauguard/${PROJECT_ID}/command/reminder`,
  ALL_COMMANDS: `rantauguard/${PROJECT_ID}/command/+`,
} as const;

export const POI_SPOTS: PoiSpot[] = [
  {
    id: "kampus_undip",
    name: "Kampus UNDIP Tembalang",
    category: "kampus",
    area: "Tembalang",
    lat: -7.0502,
    lon: 110.4398,
    radius_m: 150,
    color: "#2563EB",
  },
  {
    id: "masjid_undip",
    name: "Masjid Kampus UNDIP",
    category: "masjid",
    area: "Tembalang",
    lat: -7.0519,
    lon: 110.4398,
    radius_m: 100,
    color: "#10B981",
  },
  {
    id: "kos_mulawarman",
    name: "Kos Mulawarman",
    category: "kos",
    area: "Tembalang",
    lat: -7.0612,
    lon: 110.4338,
    radius_m: 50,
    color: "#6366F1",
  },
  {
    id: "kos_gondang",
    name: "Kos Gondang",
    category: "kos",
    area: "Tembalang",
    lat: -7.0562,
    lon: 110.4402,
    radius_m: 50,
    color: "#6366F1",
  },
  {
    id: "kos_banjarsari",
    name: "Kos Banjarsari",
    category: "kos",
    area: "Tembalang",
    lat: -7.0558,
    lon: 110.4368,
    radius_m: 50,
    color: "#6366F1",
  },
  {
    id: "bar_redhare",
    name: "RedHare Kota Lama",
    category: "bar",
    area: "Semarang Bawah",
    lat: -6.968,
    lon: 110.4285,
    radius_m: 100,
    color: "#E11D48",
  },
  {
    id: "bar_marabunta",
    name: "Marabunta Kota Lama",
    category: "bar",
    area: "Semarang Bawah",
    lat: -6.9691,
    lon: 110.4272,
    radius_m: 100,
    color: "#E11D48",
  },
  {
    id: "bar_goldentiger",
    name: "Golden Tiger Semarang",
    category: "bar",
    area: "Semarang Bawah",
    lat: -7.0016,
    lon: 110.4452,
    radius_m: 100,
    color: "#E11D48",
  },
];

export const MACRO_ZONES = [
  {
    id: "zone_kos_cluster",
    name: "Zona Kos (Mulawarman, Gondang, Banjarsari)",
    lat: -7.058,
    lon: 110.4368,
    radius_m: 650,
    color: "#6366F1",
  },
  {
    id: "zone_bar_kotalama",
    name: "Zona Hiburan Kota Lama",
    lat: -6.9685,
    lon: 110.428,
    radius_m: 450,
    color: "#E11D48",
  },
];

export function getRealtimeTimeLabel(date: Date = new Date()): TimeLabel {
  const hour = date.getHours();
  if ((hour >= 8 && hour < 12) || (hour >= 13 && hour < 16)) {
    return "jam_kuliah";
  }
  if (hour === 12 || hour === 18 || hour === 19) {
    return "waktu_sholat";
  }
  if (hour >= 22 || hour < 4) {
    return "jam_malam";
  }
  return "lainnya";
}

export function haversineDistanceM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000.0;
  const toRad = (deg: number) => (deg * Math.PI) / 180.0;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lon2 - lon1);

  const a =
    Math.sin(dPhi / 2.0) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2.0) ** 2;
  const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
  return R * c;
}

export function computeDistancesToCategories(lat: number, lon: number) {
  let distKampus = Infinity;
  let distMasjid = Infinity;
  let distKos = Infinity;
  let distBar = Infinity;

  let nearestSpot: PoiSpot = POI_SPOTS[0];
  let nearestSpotDist = Infinity;

  for (const spot of POI_SPOTS) {
    const d = haversineDistanceM(lat, lon, spot.lat, spot.lon);
    if (d < nearestSpotDist) {
      nearestSpotDist = d;
      nearestSpot = spot;
    }
    if (spot.category === "kampus" && d < distKampus) distKampus = d;
    if (spot.category === "masjid" && d < distMasjid) distMasjid = d;
    if (spot.category === "kos" && d < distKos) distKos = d;
    if (spot.category === "bar" && d < distBar) distBar = d;
  }

  return {
    distKampus,
    distMasjid,
    distKos,
    distBar,
    nearestSpot,
    nearestSpotDist,
  };
}

export function evaluateTelemetryLocally(
  lat: number,
  lon: number,
  db: number,
  timeLabel: TimeLabel
): Alert {
  const {
    distKampus,
    distMasjid,
    distKos,
    distBar,
    nearestSpot,
    nearestSpotDist,
  } = computeDistancesToCategories(lat, lon);

  const claimedAtKos = distKos <= 50.0;
  let status: AlertStatus = "NORMAL";

  if (timeLabel === "jam_malam") {
    if (claimedAtKos && db > 80.0) {
      status = "ANOMALY_FAKE_GPS";
    } else if (distBar <= 100.0 && db > 75.0) {
      status = "CRITICAL_TERDETEKSI_DI_BAR";
    } else if (distKos <= 50.0 && db < 55.0) {
      status = "ISTIRAHAT_DI_KOS";
    }
  } else if (timeLabel === "jam_kuliah") {
    if (distKampus <= 150.0 && db < 65.0) {
      status = "SEDANG_KULIAH";
    } else if (distKampus > 150.0) {
      status = "ALERT_BOLOS_KULIAH";
    }
  } else if (timeLabel === "waktu_sholat") {
    if (distMasjid > 100.0) {
      status = "WARNING_BELUM_KE_MASJID";
    }
  }

  const reasonMap: Record<AlertStatus, string> = {
    SEDANG_KULIAH: `Posisi di Kampus UNDIP (${Math.round(distKampus)} m), suara ${db.toFixed(1)} dB.`,
    ALERT_BOLOS_KULIAH: `Di luar Kampus UNDIP (${Math.round(distKampus)} m) saat jam kuliah.`,
    WARNING_BELUM_KE_MASJID: `Di luar Masjid Kampus (${Math.round(distMasjid)} m) saat waktu sholat.`,
    ISTIRAHAT_DI_KOS: `Posisi di ${nearestSpot.name} (${Math.round(distKos)} m), suara ${db.toFixed(1)} dB.`,
    CRITICAL_TERDETEKSI_DI_BAR: `Terdeteksi di ${nearestSpot.name} (${Math.round(distBar)} m), suara ${db.toFixed(1)} dB.`,
    ANOMALY_FAKE_GPS: `Lokasi klaim di ${nearestSpot.name} (${Math.round(distKos)} m), tetapi suara ${db.toFixed(1)} dB. Indikasi Fake GPS.`,
    NORMAL: `Posisi terdekat ${nearestSpot.name} (${Math.round(nearestSpotDist)} m), suara ${db.toFixed(1)} dB.`,
  };

  return {
    status,
    reason: reasonMap[status],
    timestamp_ms: Date.now(),
    context: {
      time_label: timeLabel,
      nearest_poi: nearestSpot.category,
      distance_m: Math.round(nearestSpotDist * 10) / 10,
      db: Math.round(db * 10) / 10,
    },
  };
}

export const STATUS_DISPLAY: Record<
  AlertStatus,
  {
    label: string;
    shortLabel: string;
    badgeBg: string;
    badgeText: string;
    dotColor: string;
    borderColor: string;
    severity: "normal" | "warning" | "critical";
  }
> = {
  SEDANG_KULIAH: {
    label: "SEDANG KULIAH",
    shortLabel: "Kuliah",
    badgeBg: "bg-emerald-50",
    badgeText: "text-emerald-700",
    dotColor: "bg-emerald-500",
    borderColor: "border-emerald-200",
    severity: "normal",
  },
  ISTIRAHAT_DI_KOS: {
    label: "ISTIRAHAT DI KOS",
    shortLabel: "Di Kos",
    badgeBg: "bg-blue-50",
    badgeText: "text-blue-700",
    dotColor: "bg-blue-500",
    borderColor: "border-blue-200",
    severity: "normal",
  },
  NORMAL: {
    label: "STATUS NORMAL",
    shortLabel: "Normal",
    badgeBg: "bg-slate-100",
    badgeText: "text-slate-700",
    dotColor: "bg-slate-500",
    borderColor: "border-slate-200",
    severity: "normal",
  },
  ALERT_BOLOS_KULIAH: {
    label: "BOLOS KULIAH",
    shortLabel: "Bolos",
    badgeBg: "bg-amber-50",
    badgeText: "text-amber-700",
    dotColor: "bg-amber-500",
    borderColor: "border-amber-200",
    severity: "warning",
  },
  WARNING_BELUM_KE_MASJID: {
    label: "BELUM KE MASJID",
    shortLabel: "Belum Sholat",
    badgeBg: "bg-amber-50",
    badgeText: "text-amber-700",
    dotColor: "bg-amber-500",
    borderColor: "border-amber-200",
    severity: "warning",
  },
  CRITICAL_TERDETEKSI_DI_BAR: {
    label: "TERDETEKSI DI BAR",
    shortLabel: "Di Bar",
    badgeBg: "bg-rose-50",
    badgeText: "text-rose-700",
    dotColor: "bg-rose-600",
    borderColor: "border-rose-300",
    severity: "critical",
  },
  ANOMALY_FAKE_GPS: {
    label: "ANOMALI FAKE GPS",
    shortLabel: "Fake GPS",
    badgeBg: "bg-rose-100",
    badgeText: "text-rose-800",
    dotColor: "bg-rose-600",
    borderColor: "border-rose-400",
    severity: "critical",
  },
};
