/**
 * Estimator kecepatan gerak (`speed_mps`) untuk HP Anak berbasis Centroid Jendela + Gerbang Doppler.
 *
 * Alasan desain (berdasarkan simulasi pembanding `speed_sim.py`):
 * - Algoritma anchor-based (membandingkan titik dengan anchor tunggal) gagal pada noise GPS realistis
 *   (sigma ~ 0.66 * accuracy_m): saat re-anchor atau fluktuasi dua sisi, jarak antar-sampel melampaui
 *   `accuracy_m` dalam dt=1 detik sehingga HP diam terbaca ~14.18 m/s (white noise) dan ~1.73 m/s (AR(1)).
 * - Estimator Centroid Jendela (WIN_S=20 dtk, MIN_PTS=10) membagi buffer menjadi separuh titik lama dan
 *   separuh titik baru untuk merata-ratakan jitter sebelum menghitung jarak Haversine, dengan dead-zone
 *   sebesar K * rata-rata akurasi (`macc`). Hasil simulasi: diam white noise ~0.01 m/s, AR(1) ~0.29 m/s,
 *   jalan kaki 1.4 m/s (99-100% dalam 0.8-2.2 m/s), motor 10 m/s (100% dalam 7-13 m/s).
 * - Gerbang Doppler (`nativeSpeed` dari `coords.speed` < 0.5 m/s) meredam drift multipath berkorelasi
 *   (AR(1)) saat perangkat diam hingga ~0.00 m/s dengan meluruhkan keluaran (`out *= 0.5`).
 */
import { haversineDistanceM } from "./mqttTopics";

const WIN_S = 20;
const MIN_PTS = 10;
const K = 1.0;
const EMA_ALPHA = 0.4;
const MAX_SPEED_MPS = 60;
const STALE_AFTER_S = 5;
const NATIVE_STILL_MPS = 0.5;

export interface SpeedReading {
  lat: number;
  lon: number;
  accuracy_m: number;
  timestamp_ms: number;
}

export interface SpeedTracker {
  update(
    reading: SpeedReading,
    receivedAtMs: number,
    nativeSpeed?: number | null
  ): number;
  getSpeed(nowMs: number): number;
  reset(): void;
}

interface BufferedPoint {
  lat: number;
  lon: number;
  t_s: number;
  acc: number;
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

function computeCentroid(pts: BufferedPoint[]): {
  lat: number;
  lon: number;
  t_s: number;
} {
  let sumLat = 0;
  let sumLon = 0;
  let sumT = 0;
  const len = pts.length;
  for (let i = 0; i < len; i++) {
    sumLat += pts[i].lat;
    sumLon += pts[i].lon;
    sumT += pts[i].t_s;
  }
  return {
    lat: sumLat / len,
    lon: sumLon / len,
    t_s: sumT / len,
  };
}

export function createSpeedTracker(): SpeedTracker {
  let buf: BufferedPoint[] = [];
  let ema = 0;
  let out = 0;
  let lastTimestampMs: number | null = null;
  let lastReceivedMs: number | null = null;

  return {
    update(
      reading: SpeedReading,
      receivedAtMs: number,
      nativeSpeed?: number | null
    ): number {
      if (!isValidReading(reading, receivedAtMs)) {
        return clampAndRound(out);
      }

      if (
        lastTimestampMs !== null &&
        reading.timestamp_ms <= lastTimestampMs
      ) {
        return clampAndRound(out);
      }

      lastTimestampMs = reading.timestamp_ms;
      lastReceivedMs = receivedAtMs;

      const t_s = reading.timestamp_ms / 1000;
      buf.push({
        lat: reading.lat,
        lon: reading.lon,
        t_s,
        acc: reading.accuracy_m,
      });
      buf = buf.filter((p) => t_s - p.t_s <= WIN_S);

      const n = buf.length;
      if (n >= MIN_PTS) {
        const h = Math.floor(n / 2);
        const oldCentroid = computeCentroid(buf.slice(0, h));
        const newCentroid = computeCentroid(buf.slice(n - h));
        const dt = newCentroid.t_s - oldCentroid.t_s;

        if (dt > 0) {
          let sumAcc = 0;
          for (let i = 0; i < n; i++) {
            sumAcc += buf[i].acc;
          }
          const macc = sumAcc / n;
          const d = haversineDistanceM(
            oldCentroid.lat,
            oldCentroid.lon,
            newCentroid.lat,
            newCentroid.lon
          );
          const raw = d >= K * macc ? Math.min(d / dt, MAX_SPEED_MPS) : 0;
          ema = EMA_ALPHA * raw + (1 - EMA_ALPHA) * ema;
        }
      }

      if (
        nativeSpeed !== null &&
        nativeSpeed !== undefined &&
        Number.isFinite(nativeSpeed) &&
        nativeSpeed < NATIVE_STILL_MPS
      ) {
        out = out * 0.5;
      } else {
        out = ema;
      }

      return clampAndRound(out);
    },

    getSpeed(nowMs: number): number {
      if (
        lastReceivedMs === null ||
        !Number.isFinite(nowMs) ||
        (nowMs - lastReceivedMs) / 1000 > STALE_AFTER_S
      ) {
        return 0;
      }
      return clampAndRound(out);
    },

    reset(): void {
      buf = [];
      ema = 0;
      out = 0;
      lastTimestampMs = null;
      lastReceivedMs = null;
    },
  };
}
