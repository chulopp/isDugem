import { haversineDistanceM } from "./mqttTopics";

const MIN_MOVE_M = 3;
const STATIONARY_AFTER_S = 8;
const STALE_AFTER_S = 5;
const MAX_SPEED_MPS = 60;
const EMA_ALPHA = 0.4;

export interface SpeedReading {
  lat: number;
  lon: number;
  accuracy_m: number;
  timestamp_ms: number;
}

export interface SpeedTracker {
  update(reading: SpeedReading, receivedAtMs: number): number;
  getSpeed(nowMs: number): number;
  reset(): void;
}

function clampAndRound(val: number): number {
  if (!Number.isFinite(val)) return 0;
  const clamped = Math.max(0, Math.min(MAX_SPEED_MPS, val));
  return Math.round(clamped * 100) / 100;
}

function isValidReading(reading: SpeedReading, receivedAtMs: number): boolean {
  if (!reading || typeof reading !== "object") return false;
  const { lat, lon, accuracy_m, timestamp_ms } = reading;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(accuracy_m) ||
    !Number.isFinite(timestamp_ms) ||
    !Number.isFinite(receivedAtMs)
  ) {
    return false;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return false;
  }
  if (accuracy_m < 0) {
    return false;
  }
  return true;
}

export function createSpeedTracker(): SpeedTracker {
  let anchor: { lat: number; lon: number; t: number } | null = null;
  let ema = 0;
  let lastReceivedMs: number | null = null;

  return {
    update(reading: SpeedReading, receivedAtMs: number): number {
      if (!isValidReading(reading, receivedAtMs)) {
        return clampAndRound(ema);
      }

      if (anchor === null) {
        anchor = {
          lat: reading.lat,
          lon: reading.lon,
          t: reading.timestamp_ms,
        };
        lastReceivedMs = receivedAtMs;
        return 0;
      }

      const dt = (reading.timestamp_ms - anchor.t) / 1000;
      if (dt <= 0) {
        return clampAndRound(ema);
      }

      lastReceivedMs = receivedAtMs;
      const d = haversineDistanceM(
        anchor.lat,
        anchor.lon,
        reading.lat,
        reading.lon
      );
      const threshold = Math.max(reading.accuracy_m, MIN_MOVE_M);

      if (d >= threshold) {
        const raw = Math.min(d / dt, MAX_SPEED_MPS);
        ema = EMA_ALPHA * raw + (1 - EMA_ALPHA) * ema;
        anchor = {
          lat: reading.lat,
          lon: reading.lon,
          t: reading.timestamp_ms,
        };
      } else if (dt >= STATIONARY_AFTER_S) {
        ema = (1 - EMA_ALPHA) * ema;
        anchor = {
          lat: reading.lat,
          lon: reading.lon,
          t: reading.timestamp_ms,
        };
      }

      return clampAndRound(ema);
    },

    getSpeed(nowMs: number): number {
      if (
        lastReceivedMs === null ||
        !Number.isFinite(nowMs) ||
        (nowMs - lastReceivedMs) / 1000 > STALE_AFTER_S
      ) {
        return 0;
      }
      return clampAndRound(ema);
    },

    reset(): void {
      anchor = null;
      ema = 0;
      lastReceivedMs = null;
    },
  };
}
