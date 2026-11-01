import { describe, expect, it } from "vitest";
import { createSpeedTracker } from "./speed";

const BASE_LAT = -7.0502;
const BASE_LON = 110.4398;
const EARTH_R = 6371000.0;

/**
 * PRNG deterministik (Mulberry32) dengan seed tetap agar tes bebas flaky.
 */
function createPrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Menggeser koordinat (lat, lon) sejauh northM (utara) dan eastM (timur) dalam meter.
 */
function offsetMeters(
  lat: number,
  lon: number,
  northM: number,
  eastM: number
): { lat: number; lon: number } {
  const dLat = (northM / EARTH_R) * (180 / Math.PI);
  const dLon =
    (eastM / (EARTH_R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: lat + dLat, lon: lon + dLon };
}

describe("createSpeedTracker", () => {
  it("pembacaan pertama mengembalikan 0", () => {
    const tracker = createSpeedTracker();
    const speed = tracker.update(
      {
        lat: BASE_LAT,
        lon: BASE_LON,
        accuracy_m: 8.0,
        timestamp_ms: 1_000_000,
      },
      1_000_000
    );
    expect(speed).toBe(0);
    expect(tracker.getSpeed(1_000_500)).toBe(0);
  });

  it("jitter acak 5-15 m di titik yang sama selama 60 detik menghasilkan speed akhir mendekati 0 (< 0.3)", () => {
    const tracker = createSpeedTracker();
    const rand = createPrng(42);
    const startTs = 1_000_000;

    // Pembacaan pertama tepat di titik asli (BASE_LAT, BASE_LON) sebagai anchor
    tracker.update(
      {
        lat: BASE_LAT,
        lon: BASE_LON,
        accuracy_m: 15.0,
        timestamp_ms: startTs,
      },
      startTs
    );

    let lastSpeed = 0;
    for (let s = 1; s <= 60; s++) {
      // Jitter acak sejauh 5..15 m dari titik pusat selama 60 detik
      const jitterM = 5 + rand() * 10; // 5..15 m
      const angle = rand() * 2 * Math.PI;
      const pos = offsetMeters(
        BASE_LAT,
        BASE_LON,
        Math.cos(angle) * jitterM,
        Math.sin(angle) * jitterM
      );
      const ts = startTs + s * 1000;
      lastSpeed = tracker.update(
        {
          lat: pos.lat,
          lon: pos.lon,
          accuracy_m: 30.0,
          timestamp_ms: ts,
        },
        ts
      );
    }

    expect(lastSpeed).toBeLessThan(0.3);
    expect(lastSpeed).toBeGreaterThanOrEqual(0);
  });

  it("simulasi jalan lurus 1.4 m/s tiap 1 detik (accuracy 8 m, noise +-4 m) stabil antara 0.8 dan 2.2 setelah 20 detik", () => {
    const tracker = createSpeedTracker();
    const rand = createPrng(1337);
    const startTs = 2_000_000;

    for (let s = 0; s <= 30; s++) {
      const trueNorthM = s * 1.4;
      const noiseNorthM = (rand() * 2 - 1) * 4.0;
      const noiseEastM = (rand() * 2 - 1) * 4.0;
      const pos = offsetMeters(
        BASE_LAT,
        BASE_LON,
        trueNorthM + noiseNorthM,
        noiseEastM
      );
      const ts = startTs + s * 1000;
      const speed = tracker.update(
        {
          lat: pos.lat,
          lon: pos.lon,
          accuracy_m: 8.0,
          timestamp_ms: ts,
        },
        ts
      );

      if (s >= 20) {
        expect(speed).toBeGreaterThanOrEqual(0.8);
        expect(speed).toBeLessThanOrEqual(2.2);
      }
    }
  });

  it("simulasi 10 m/s (motor) menghasilkan speed antara 7 dan 13 setelah 20 detik", () => {
    const tracker = createSpeedTracker();
    const rand = createPrng(2026);
    const startTs = 3_000_000;

    for (let s = 0; s <= 25; s++) {
      const trueEastM = s * 10.0;
      const noiseNorthM = (rand() * 2 - 1) * 3.0;
      const noiseEastM = (rand() * 2 - 1) * 3.0;
      const pos = offsetMeters(
        BASE_LAT,
        BASE_LON,
        noiseNorthM,
        trueEastM + noiseEastM
      );
      const ts = startTs + s * 1000;
      const speed = tracker.update(
        {
          lat: pos.lat,
          lon: pos.lon,
          accuracy_m: 8.0,
          timestamp_ms: ts,
        },
        ts
      );

      if (s >= 20) {
        expect(speed).toBeGreaterThanOrEqual(7);
        expect(speed).toBeLessThanOrEqual(13);
      }
    }
  });

  it("lonjakan posisi 5 km dalam 1 detik dibatasi <= 60 m/s dan tetap terhingga", () => {
    const tracker = createSpeedTracker();
    const startTs = 4_000_000;

    tracker.update(
      {
        lat: BASE_LAT,
        lon: BASE_LON,
        accuracy_m: 5.0,
        timestamp_ms: startTs,
      },
      startTs
    );

    const jumped = offsetMeters(BASE_LAT, BASE_LON, 5000, 0);
    const speed = tracker.update(
      {
        lat: jumped.lat,
        lon: jumped.lon,
        accuracy_m: 5.0,
        timestamp_ms: startTs + 1000,
      },
      startTs + 1000
    );

    expect(Number.isFinite(speed)).toBe(true);
    expect(speed).toBeLessThanOrEqual(60);
    expect(speed).toBeGreaterThan(0);
    // EMA_ALPHA (0.4) * 60 = 24
    expect(speed).toBe(24);
  });

  it("timestamp mundur atau duplikat diabaikan dan tidak mengubah hasil", () => {
    const tracker = createSpeedTracker();
    const t0 = 5_000_000;

    tracker.update(
      { lat: BASE_LAT, lon: BASE_LON, accuracy_m: 5.0, timestamp_ms: t0 },
      t0
    );

    const p1 = offsetMeters(BASE_LAT, BASE_LON, 10, 0);
    const speedAfterMove = tracker.update(
      { lat: p1.lat, lon: p1.lon, accuracy_m: 5.0, timestamp_ms: t0 + 1000 },
      t0 + 1000
    );
    expect(speedAfterMove).toBeGreaterThan(0);

    // Duplikat timestamp
    const pDup = offsetMeters(BASE_LAT, BASE_LON, 100, 0);
    const speedDup = tracker.update(
      {
        lat: pDup.lat,
        lon: pDup.lon,
        accuracy_m: 5.0,
        timestamp_ms: t0 + 1000,
      },
      t0 + 2000
    );
    expect(speedDup).toBe(speedAfterMove);

    // Timestamp mundur
    const speedBack = tracker.update(
      {
        lat: pDup.lat,
        lon: pDup.lon,
        accuracy_m: 5.0,
        timestamp_ms: t0 + 500,
      },
      t0 + 3000
    );
    expect(speedBack).toBe(speedAfterMove);
  });

  it("input NaN, Infinity, atau lat di luar rentang (200) tidak melempar error dan hasil tetap terhingga", () => {
    const tracker = createSpeedTracker();
    const t0 = 6_000_000;

    expect(() =>
      tracker.update(
        { lat: NaN, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 },
        t0
      )
    ).not.toThrow();
    expect(tracker.getSpeed(t0)).toBe(0);

    tracker.update(
      { lat: BASE_LAT, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 },
      t0
    );
    const p1 = offsetMeters(BASE_LAT, BASE_LON, 10, 0);
    const validSpeed = tracker.update(
      { lat: p1.lat, lon: p1.lon, accuracy_m: 5, timestamp_ms: t0 + 1000 },
      t0 + 1000
    );

    const invalidInputs = [
      { lat: NaN, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 + 2000 },
      { lat: BASE_LAT, lon: Infinity, accuracy_m: 5, timestamp_ms: t0 + 2000 },
      {
        lat: BASE_LAT,
        lon: BASE_LON,
        accuracy_m: -Infinity,
        timestamp_ms: t0 + 2000,
      },
      { lat: 200, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 + 2000 },
      { lat: -95, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 + 2000 },
      { lat: BASE_LAT, lon: 190, accuracy_m: 5, timestamp_ms: t0 + 2000 },
      { lat: BASE_LAT, lon: BASE_LON, accuracy_m: 5, timestamp_ms: NaN },
    ];

    for (const bad of invalidInputs) {
      const res = tracker.update(bad, t0 + 2000);
      expect(Number.isFinite(res)).toBe(true);
      expect(res).toBe(validSpeed);
    }

    expect(Number.isFinite(tracker.getSpeed(NaN))).toBe(true);
    expect(tracker.getSpeed(NaN)).toBe(0);
  });

  it("getSpeed() setelah > 5 detik tanpa update mengembalikan 0", () => {
    const tracker = createSpeedTracker();
    const t0 = 7_000_000;

    tracker.update(
      { lat: BASE_LAT, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 },
      t0
    );
    const p1 = offsetMeters(BASE_LAT, BASE_LON, 12, 0);
    const speed = tracker.update(
      { lat: p1.lat, lon: p1.lon, accuracy_m: 5, timestamp_ms: t0 + 1000 },
      t0 + 1000
    );
    expect(speed).toBeGreaterThan(0);

    // Tepat 5 detik masih segar
    expect(tracker.getSpeed(t0 + 1000 + 5000)).toBe(speed);

    // Lebih dari 5 detik dianggap stale -> 0
    expect(tracker.getSpeed(t0 + 1000 + 5001)).toBe(0);
    expect(tracker.getSpeed(t0 + 1000 + 10000)).toBe(0);
  });

  it("setelah diam 30 detik lalu mulai berjalan, speed naik > 0.5 dalam 15 detik (uji re-anchor)", () => {
    const tracker = createSpeedTracker();
    const startTs = 8_000_000;

    // Diam selama 30 detik di titik awal
    for (let s = 0; s <= 30; s++) {
      const ts = startTs + s * 1000;
      tracker.update(
        {
          lat: BASE_LAT,
          lon: BASE_LON,
          accuracy_m: 8.0,
          timestamp_ms: ts,
        },
        ts
      );
    }

    expect(tracker.getSpeed(startTs + 30_000)).toBe(0);

    // Mulai berjalan 1.4 m/s selama 15 detik
    let walkSpeed = 0;
    for (let s = 1; s <= 15; s++) {
      const pos = offsetMeters(BASE_LAT, BASE_LON, s * 1.4, 0);
      const ts = startTs + (30 + s) * 1000;
      walkSpeed = tracker.update(
        {
          lat: pos.lat,
          lon: pos.lon,
          accuracy_m: 8.0,
          timestamp_ms: ts,
        },
        ts
      );
    }

    // Jika tidak di-re-anchor saat diam 30 detik, dt akan bengkak (~36 detik untuk 8.4 m -> 0.23 m/s).
    // Karena ada re-anchor tiap 8 detik, saat berjalan speed langsung naik > 0.5 m/s.
    expect(walkSpeed).toBeGreaterThan(0.5);
  });

  it("reset() mengosongkan semua keadaan kembali ke awal", () => {
    const tracker = createSpeedTracker();
    const t0 = 9_000_000;

    tracker.update(
      { lat: BASE_LAT, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 },
      t0
    );
    const p1 = offsetMeters(BASE_LAT, BASE_LON, 15, 0);
    expect(
      tracker.update(
        { lat: p1.lat, lon: p1.lon, accuracy_m: 5, timestamp_ms: t0 + 1000 },
        t0 + 1000
      )
    ).toBeGreaterThan(0);

    tracker.reset();
    expect(tracker.getSpeed(t0 + 1000)).toBe(0);
    // Pembacaan pertama setelah reset harus kembali 0
    expect(
      tracker.update(
        { lat: BASE_LAT, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 + 2000 },
        t0 + 2000
      )
    ).toBe(0);
  });
});
