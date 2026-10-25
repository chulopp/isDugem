import {
  DemoPreset,
  LiveTripRoute,
  SystemEventLog,
  TelemetryHistoryPoint,
} from "./types";

export const DEMO_PRESETS: DemoPreset[] = [
  {
    id: "preset_kuliah",
    title: "Kuliah di Kampus UNDIP",
    subtitle: "Jam kuliah, di area kampus, suara kondusif",
    time_label: "jam_kuliah",
    time_display: "09:00 WIB (Jam Kuliah)",
    lat: -7.0502,
    lon: 110.4398,
    db: 52.4,
    expected_status: "SEDANG_KULIAH",
    location_name: "Kampus UNDIP Tembalang",
  },
  {
    id: "preset_bolos",
    title: "Bolos Kuliah",
    subtitle: "Jam kuliah, posisi di luar area kampus",
    time_label: "jam_kuliah",
    time_display: "10:15 WIB (Jam Kuliah)",
    lat: -7.0562,
    lon: 110.4402,
    db: 58.0,
    expected_status: "ALERT_BOLOS_KULIAH",
    location_name: "Kos Gondang",
  },
  {
    id: "preset_sholat",
    title: "Waktu Sholat Belum ke Masjid",
    subtitle: "Waktu sholat, posisi jauh dari Masjid Kampus",
    time_label: "waktu_sholat",
    time_display: "12:15 WIB (Waktu Sholat)",
    lat: -7.0558,
    lon: 110.4368,
    db: 54.0,
    expected_status: "WARNING_BELUM_KE_MASJID",
    location_name: "Kos Banjarsari",
  },
  {
    id: "preset_kos",
    title: "Istirahat di Kos Mulawarman",
    subtitle: "Jam malam, di dalam kos, suara tenang",
    time_label: "jam_malam",
    time_display: "22:30 WIB (Jam Malam)",
    lat: -7.0612,
    lon: 110.4338,
    db: 41.5,
    expected_status: "ISTIRAHAT_DI_KOS",
    location_name: "Kos Mulawarman",
  },
  {
    id: "preset_bar_kotalama",
    title: "Terdeteksi di RedHare Kota Lama",
    subtitle: "Jam malam, posisi di Kota Lama, suara 84.2 dB",
    time_label: "jam_malam",
    time_display: "23:20 WIB (Jam Malam)",
    lat: -6.968,
    lon: 110.4285,
    db: 84.2,
    expected_status: "CRITICAL_TERDETEKSI_DI_BAR",
    location_name: "RedHare Kota Lama",
  },
  {
    id: "preset_bar_goldentiger",
    title: "Terdeteksi di Golden Tiger",
    subtitle: "Jam malam, posisi di Semarang Bawah, suara 88.0 dB",
    time_label: "jam_malam",
    time_display: "23:40 WIB (Jam Malam)",
    lat: -7.0016,
    lon: 110.4452,
    db: 88.0,
    expected_status: "CRITICAL_TERDETEKSI_DI_BAR",
    location_name: "Golden Tiger Semarang",
  },
  {
    id: "preset_fake_gps",
    title: "Anomali Fake GPS (Kos Mulawarman)",
    subtitle: "Lokasi klaim di kos, tetapi suara terdeteksi 86.5 dB",
    time_label: "jam_malam",
    time_display: "23:55 WIB (Jam Malam)",
    lat: -7.0612,
    lon: 110.4338,
    db: 86.5,
    expected_status: "ANOMALY_FAKE_GPS",
    location_name: "Kos Mulawarman (Klaim GPS)",
  },
];

export const LIVE_TRIP_ROUTES: LiveTripRoute[] = [
  {
    id: "route_kampus_kos",
    name: "Rute Kampus UNDIP ke Kos Mulawarman",
    fromName: "Kampus UNDIP",
    toName: "Kos Mulawarman",
    time_label: "jam_malam",
    targetDb: 44.0,
    waypoints: [
      [-7.0502, 110.4398],
      [-7.0519, 110.4398],
      [-7.0535, 110.4392],
      [-7.0558, 110.4368],
      [-7.0578, 110.4355],
      [-7.0595, 110.4345],
      [-7.0612, 110.4338],
    ],
  },
  {
    id: "route_kos_kotalama",
    name: "Rute Kos Gondang ke RedHare Kota Lama",
    fromName: "Kos Gondang",
    toName: "RedHare Kota Lama",
    time_label: "jam_malam",
    targetDb: 84.5,
    waypoints: [
      [-7.0562, 110.4402],
      [-7.0525, 110.435],
      [-7.044, 110.4215],
      [-7.0285, 110.418],
      [-7.011, 110.422],
      [-6.992, 110.424],
      [-6.978, 110.4265],
      [-6.968, 110.4285],
    ],
  },
  {
    id: "route_kos_goldentiger",
    name: "Rute Kos Mulawarman ke Golden Tiger",
    fromName: "Kos Mulawarman",
    toName: "Golden Tiger Semarang",
    time_label: "jam_malam",
    targetDb: 87.5,
    waypoints: [
      [-7.0612, 110.4338],
      [-7.0558, 110.4368],
      [-7.045, 110.428],
      [-7.029, 110.434],
      [-7.015, 110.441],
      [-7.0016, 110.4452],
    ],
  },
];

export async function fetchOsrmStreetRoute(
  startLat: number,
  startLon: number,
  endLat: number,
  endLon: number,
  fallbackWaypoints: [number, number][]
): Promise<[number, number][]> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${endLon},${endLat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return fallbackWaypoints;
    const data = await res.json();
    const coords = data?.routes?.[0]?.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length > 2) {
      return coords.map((c: [number, number]) => [c[1], c[0]]);
    }
    return fallbackWaypoints;
  } catch {
    return fallbackWaypoints;
  }
}

export const INITIAL_HISTORY: TelemetryHistoryPoint[] = [];

export const INITIAL_EVENTS: SystemEventLog[] = [];
