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
    lat: -7.062817,
    lon: 110.440401,
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
    lat: -7.059141,
    lon: 110.435523,
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
    lat: -7.067588,
    lon: 110.439708,
    db: 41.5,
    expected_status: "ISTIRAHAT_DI_KOS",
    location_name: "Kos Mulawarman",
  },
  {
    id: "preset_bar_redhare",
    title: "Terdeteksi di RedHare Semarang",
    subtitle: "Jam malam, posisi di Semarang Bawah, suara 84.2 dB",
    time_label: "jam_malam",
    time_display: "23:20 WIB (Jam Malam)",
    lat: -6.976429,
    lon: 110.41295,
    db: 84.2,
    expected_status: "CRITICAL_TERDETEKSI_DI_BAR",
    location_name: "RedHare Semarang",
  },
  {
    id: "preset_bar_goldentiger",
    title: "Terdeteksi di Golden Tiger",
    subtitle: "Jam malam, posisi di Kota Lama, suara 88.0 dB",
    time_label: "jam_malam",
    time_display: "23:40 WIB (Jam Malam)",
    lat: -6.966984,
    lon: 110.429807,
    db: 88.0,
    expected_status: "CRITICAL_TERDETEKSI_DI_BAR",
    location_name: "Golden Tiger Semarang",
  },
  {
    id: "preset_bar_hwtiger",
    title: "Terdeteksi di HW Tiger Club",
    subtitle: "Jam malam, posisi di Kota Lama, suara 89.5 dB",
    time_label: "jam_malam",
    time_display: "23:50 WIB (Jam Malam)",
    lat: -6.965717,
    lon: 110.429464,
    db: 89.5,
    expected_status: "CRITICAL_TERDETEKSI_DI_BAR",
    location_name: "HW Tiger Club Semarang",
  },
  {
    id: "preset_fake_gps",
    title: "Anomali Fake GPS (Kos Mulawarman)",
    subtitle: "Lokasi klaim di kos, tetapi suara terdeteksi 86.5 dB",
    time_label: "jam_malam",
    time_display: "23:55 WIB (Jam Malam)",
    lat: -7.067588,
    lon: 110.439708,
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
      [-7.0552, 110.437],
      [-7.059141, 110.435523],
      [-7.062817, 110.440401],
      [-7.067588, 110.439708],
    ],
  },
  {
    id: "route_kos_redhare",
    name: "Rute Kos Gondang ke RedHare Semarang",
    fromName: "Kos Gondang",
    toName: "RedHare Semarang",
    time_label: "jam_malam",
    targetDb: 84.5,
    waypoints: [
      [-7.062817, 110.440401],
      [-7.045, 110.425],
      [-7.025, 110.42],
      [-7.0, 110.418],
      [-6.976429, 110.41295],
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
      [-7.067588, 110.439708],
      [-7.0552, 110.437],
      [-7.03, 110.43],
      [-7.0, 110.43],
      [-6.966984, 110.429807],
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
