export type AlertStatus =
  | "SEDANG_KULIAH"
  | "ALERT_BOLOS_KULIAH"
  | "WARNING_BELUM_KE_MASJID"
  | "ISTIRAHAT_DI_KOS"
  | "CRITICAL_TERDETEKSI_DI_BAR"
  | "ANOMALY_FAKE_GPS"
  | "NORMAL";

export type TimeLabel = "jam_kuliah" | "waktu_sholat" | "jam_malam" | "lainnya";
export type TimeMode = "auto" | TimeLabel;

export interface AnakTelemetry {
  device_id: "anak";
  sequence: number;
  sent_at_ms: number;
  location: {
    lat: number;
    lon: number;
    accuracy_m: number;
  };
  audio: {
    rms: number;
    db: number;
  };
  motion: {
    accel_magnitude: number;
  };
}

export interface OrtuTelemetry {
  device_id: "ortu";
  sequence: number;
  sent_at_ms: number;
  location: {
    lat: number;
    lon: number;
    accuracy_m?: number;
  };
  motion: {
    accel_magnitude: number;
    shake_detected: boolean;
  };
}

export interface AlertContext {
  time_label: TimeLabel | string;
  nearest_poi: string;
  distance_m: number;
  db: number;
}

export interface Alert {
  status: AlertStatus;
  reason: string;
  timestamp_ms: number;
  context: AlertContext;
}

export interface CommandPayload {
  triggered_by: "ortu" | "dashboard" | "anak";
  timestamp_ms: number;
  message: string;
}

export interface PoiSpot {
  id: string;
  name: string;
  category: "kampus" | "masjid" | "kos" | "bar";
  area: "Tembalang" | "Semarang Bawah";
  lat: number;
  lon: number;
  radius_m: number;
  color: string;
}

export interface TelemetryHistoryPoint {
  time: string;
  timestamp_ms: number;
  db: number;
  distance_m: number;
  nearest_poi: string;
}

export interface SystemEventLog {
  id: string;
  sender: string;
  role: "server" | "ortu" | "anak" | "dashboard";
  time: string;
  timestamp_ms: number;
  title: string;
  message: string;
  severity: "normal" | "warning" | "critical" | "info";
  meta?: string;
}

export interface DemoPreset {
  id: string;
  title: string;
  subtitle: string;
  time_label: TimeLabel;
  time_display: string;
  lat: number;
  lon: number;
  db: number;
  expected_status: AlertStatus;
  location_name: string;
}

export interface LiveTripRoute {
  id: string;
  name: string;
  fromName: string;
  toName: string;
  time_label: TimeLabel;
  targetDb: number;
  waypoints: [number, number][];
}
