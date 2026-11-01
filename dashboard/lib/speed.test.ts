import { describe, expect, it } from "vitest";
import { createSpeedTracker } from "./speed";

const BASE_LAT = -7.0502;
const BASE_LON = 110.4398;
const EARTH_R = 6371000.0;

/**
 * PRNG deterministik (Mulberry32) dengan seed tetap agar tes bebas flaky.
 */
function createPrng(seed: number): {
  next: () => number;
  uniform: (lo: number, hi: number) => number;
  gauss: (mean?: number, std?: number) => number;
} {
  let a = seed >>> 0;
  let spare: number | null = null;

  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const uniform = (lo: number, hi: number) => lo + (hi - lo) * next();

  const gauss = (mean = 0, std = 1) => {
    if (spare !== null) {
      const val = spare;
      spare = null;
      return mean + std * val;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = next();
    while (v === 0) v = next();
    const mag = Math.sqrt(-2.0 * Math.log(u));
    const z0 = mag * Math.cos(2.0 * Math.PI * v);
    spare = mag * Math.sin(2.0 * Math.PI * v);
    return mean + std * z0;
  };

  return { next, uniform, gauss };
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

/**
 * Model noise realistis GPS per sumbu: Gaussian dengan sigma = 0.66 * accuracy_m
 * (memuat ~68% titik dalam radius akurasi), dengan faktor korelasi AR(1) rho.
 */
function stepNoise(
  acc: number,
  rng: ReturnType<typeof createPrng>,
  ex: number,
  ey: number,
  rho: number
): [number, number] {
  const sg = 0.66 * acc;
  const scale = Math.sqrt(1 - rho * rho);
  const nextEx = rho * ex + scale * rng.gauss(0, sg);
  const nextEy = rho * ey + scale * rng.gauss(0, sg);
  return [nextEx, nextEy];
}

describe("createSpeedTracker (Centroid Jendela + Gerbang Doppler)", () => {
  it("a. pembacaan pertama mengembalikan 0", () => {
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

  it("b. diam 60 detik dengan noise acak realistis (30 seed tetap, tanpa nativeSpeed): speed akhir < 0.3 pada >= 95% seed", () => {
    const numSeeds = 30;
    let passedSeeds = 0;
    const finalSpeeds: number[] = [];

    for (let seed = 1; seed <= numSeeds; seed++) {
      const rng = createPrng(seed * 101);
      const tracker = createSpeedTracker();
      const acc = rng.uniform(8, 15);
      let ex = 0;
      let ey = 0;
      let lastSpeed = 0;
      const startTs = 1_000_000;

      for (let t = 0; t <= 60; t++) {
        [ex, ey] = stepNoise(acc, rng, ex, ey, 0.0);
        const pos = offsetMeters(BASE_LAT, BASE_LON, ey, ex);
        const ts = startTs + t * 1000;
        lastSpeed = tracker.update(
          {
            lat: pos.lat,
            lon: pos.lon,
            accuracy_m: acc,
            timestamp_ms: ts,
          },
          ts
        );
      }

      finalSpeeds.push(lastSpeed);
      if (lastSpeed < 0.3) {
        passedSeeds++;
      }
    }

    const passRatio = passedSeeds / numSeeds;
    const meanFinal =
      finalSpeeds.reduce((a, b) => a + b, 0) / finalSpeeds.length;
    console.info(
      `[Test b] Passed seeds (<0.3 m/s): ${passedSeeds}/${numSeeds} (${(
        passRatio * 100
      ).toFixed(1)}%), mean final speed = ${meanFinal.toFixed(4)} m/s`
    );

    expect(passRatio).toBeGreaterThanOrEqual(0.95);
  });

  it("c. diam dengan noise berkorelasi AR(1) rho=0.9: tanpa nativeSpeed rata-rata < 0.6; dengan nativeSpeed ~0.03 rata-rata < 0.05", () => {
    // Catatan batas yang diketahui:
    // Pada noise GPS berkorelasi kuat (AR(1) rho=0.9, mis. multipath gedung), posisi semu
    // mengalami drift searah selama beberapa belas detik sehingga tanpa Doppler (nativeSpeed)
    // centroid jendela 20 detik masih dapat mendeteksi drift kecil (~0.25-0.35 m/s rata-rata, < 0.6 m/s).
    // Ketika nativeSpeed (Doppler chip GPS, ~0.03 m/s saat diam) tersedia, gerbang Doppler
    // menekan keluaran hingga mendekati 0 (< 0.05 m/s).
    const numSeeds = 30;
    const finalsWithoutNative: number[] = [];
    const finalsWithNative: number[] = [];

    for (let seed = 1; seed <= numSeeds; seed++) {
      const rng1 = createPrng(500 + seed);
      const rng2 = createPrng(500 + seed);
      const trackerNoNative = createSpeedTracker();
      const trackerWithNative = createSpeedTracker();

      const acc1 = rng1.uniform(8, 15);
      const acc2 = rng2.uniform(8, 15);
      let ex1 = 0,
        ey1 = 0;
      let ex2 = 0,
        ey2 = 0;
      let lastNoNative = 0;
      let lastWithNative = 0;
      const startTs = 2_000_000;

      for (let t = 0; t <= 60; t++) {
        [ex1, ey1] = stepNoise(acc1, rng1, ex1, ey1, 0.9);
        const pos1 = offsetMeters(BASE_LAT, BASE_LON, ey1, ex1);
        const ts = startTs + t * 1000;
        lastNoNative = trackerNoNative.update(
          {
            lat: pos1.lat,
            lon: pos1.lon,
            accuracy_m: acc1,
            timestamp_ms: ts,
          },
          ts
        );

        [ex2, ey2] = stepNoise(acc2, rng2, ex2, ey2, 0.9);
        const pos2 = offsetMeters(BASE_LAT, BASE_LON, ey2, ex2);
        const nativeStill = Math.abs(rng2.gauss(0.03, 0.02));
        lastWithNative = trackerWithNative.update(
          {
            lat: pos2.lat,
            lon: pos2.lon,
            accuracy_m: acc2,
            timestamp_ms: ts,
          },
          ts,
          nativeStill
        );
      }

      finalsWithoutNative.push(lastNoNative);
      finalsWithNative.push(lastWithNative);
    }

    const meanWithoutNative =
      finalsWithoutNative.reduce((a, b) => a + b, 0) / numSeeds;
    const meanWithNative =
      finalsWithNative.reduce((a, b) => a + b, 0) / numSeeds;

    console.info(
      `[Test c] AR(1) rho=0.9 mean final speed: without nativeSpeed = ${meanWithoutNative.toFixed(
        4
      )} m/s, with nativeSpeed ~0.03 = ${meanWithNative.toFixed(4)} m/s`
    );

    expect(meanWithoutNative).toBeLessThan(0.6);
    expect(meanWithNative).toBeLessThan(0.05);
  });

  it("d. jalan lurus 1.4 m/s: (acc 8, noise +-4) 100% sampel t>=20 dalam 0.8-2.2; (acc 10, noise +-8) >= 95% sampel t>=20 dalam 0.8-2.2", () => {
    const numSeeds = 30;
    let totalAcc8 = 0;
    let inRangeAcc8 = 0;
    let sumAcc8 = 0;

    let totalAcc10 = 0;
    let inRangeAcc10 = 0;
    let sumAcc10 = 0;

    for (let seed = 1; seed <= numSeeds; seed++) {
      const rng8 = createPrng(1000 + seed);
      const tracker8 = createSpeedTracker();
      const startTs = 3_000_000;

      for (let t = 0; t <= 30; t++) {
        const px = rng8.uniform(-4, 4);
        const py = rng8.uniform(-4, 4);
        const pos = offsetMeters(BASE_LAT, BASE_LON, t * 1.4 + py, px);
        const ts = startTs + t * 1000;
        const v = tracker8.update(
          {
            lat: pos.lat,
            lon: pos.lon,
            accuracy_m: 8.0,
            timestamp_ms: ts,
          },
          ts
        );
        if (t >= 20) {
          totalAcc8++;
          sumAcc8 += v;
          if (v >= 0.8 && v <= 2.2) {
            inRangeAcc8++;
          }
          expect(v).toBeGreaterThanOrEqual(0.8);
          expect(v).toBeLessThanOrEqual(2.2);
        }
      }

      const rng10 = createPrng(2000 + seed);
      const tracker10 = createSpeedTracker();
      for (let t = 0; t <= 30; t++) {
        const px = rng10.uniform(-8, 8);
        const py = rng10.uniform(-8, 8);
        const pos = offsetMeters(BASE_LAT, BASE_LON, t * 1.4 + py, px);
        const ts = startTs + t * 1000;
        const v = tracker10.update(
          {
            lat: pos.lat,
            lon: pos.lon,
            accuracy_m: 10.0,
            timestamp_ms: ts,
          },
          ts
        );
        if (t >= 20) {
          totalAcc10++;
          sumAcc10 += v;
          if (v >= 0.8 && v <= 2.2) {
            inRangeAcc10++;
          }
        }
      }
    }

    const ratioAcc8 = inRangeAcc8 / totalAcc8;
    const ratioAcc10 = inRangeAcc10 / totalAcc10;
    console.info(
      `[Test d] Walk 1.4 m/s: acc8+-4 in-range=${inRangeAcc8}/${totalAcc8} (${(
        ratioAcc8 * 100
      ).toFixed(1)}%, mean=${(sumAcc8 / totalAcc8).toFixed(
        3
      )} m/s); acc10+-8 in-range=${inRangeAcc10}/${totalAcc10} (${(
        ratioAcc10 * 100
      ).toFixed(1)}%, mean=${(sumAcc10 / totalAcc10).toFixed(3)} m/s)`
    );

    expect(ratioAcc8).toBe(1.0);
    expect(ratioAcc10).toBeGreaterThanOrEqual(0.95);
  });

  it("e. motor 10 m/s (acc 8, noise +-8): semua sampel t>=20 berada dalam 7-13 m/s", () => {
    const rng = createPrng(3001);
    const tracker = createSpeedTracker();
    const startTs = 4_000_000;

    for (let t = 0; t <= 30; t++) {
      const px = rng.uniform(-8, 8);
      const py = rng.uniform(-8, 8);
      const pos = offsetMeters(BASE_LAT, BASE_LON, t * 10.0 + py, px);
      const ts = startTs + t * 1000;
      const v = tracker.update(
        {
          lat: pos.lat,
          lon: pos.lon,
          accuracy_m: 8.0,
          timestamp_ms: ts,
        },
        ts
      );
      if (t >= 20) {
        expect(v).toBeGreaterThanOrEqual(7);
        expect(v).toBeLessThanOrEqual(13);
      }
    }
  });

  it("f. lonjakan posisi 5 km setelah 15 titik diam menghasilkan nilai terhingga dan <= 60 m/s", () => {
    const tracker = createSpeedTracker();
    const startTs = 5_000_000;

    for (let t = 0; t < 15; t++) {
      const ts = startTs + t * 1000;
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

    const jumped = offsetMeters(BASE_LAT, BASE_LON, 5000, 0);
    const tsJump = startTs + 15 * 1000;
    const speed = tracker.update(
      {
        lat: jumped.lat,
        lon: jumped.lon,
        accuracy_m: 8.0,
        timestamp_ms: tsJump,
      },
      tsJump
    );

    expect(Number.isFinite(speed)).toBe(true);
    expect(speed).toBeGreaterThan(0);
    expect(speed).toBeLessThanOrEqual(60);
  });

  it("g. timestamp mundur atau duplikat diabaikan dan tidak mengubah hasil", () => {
    const tracker = createSpeedTracker();
    const t0 = 6_000_000;

    let lastSpeed = 0;
    for (let t = 0; t <= 15; t++) {
      const pos = offsetMeters(BASE_LAT, BASE_LON, t * 5.0, 0);
      const ts = t0 + t * 1000;
      lastSpeed = tracker.update(
        {
          lat: pos.lat,
          lon: pos.lon,
          accuracy_m: 5.0,
          timestamp_ms: ts,
        },
        ts
      );
    }
    expect(lastSpeed).toBeGreaterThan(0);

    // Timestamp duplikat
    const farPos = offsetMeters(BASE_LAT, BASE_LON, 1000, 1000);
    const dupSpeed = tracker.update(
      {
        lat: farPos.lat,
        lon: farPos.lon,
        accuracy_m: 5.0,
        timestamp_ms: t0 + 15 * 1000,
      },
      t0 + 16 * 1000
    );
    expect(dupSpeed).toBe(lastSpeed);

    // Timestamp mundur
    const backSpeed = tracker.update(
      {
        lat: farPos.lat,
        lon: farPos.lon,
        accuracy_m: 5.0,
        timestamp_ms: t0 + 10 * 1000,
      },
      t0 + 17 * 1000
    );
    expect(backSpeed).toBe(lastSpeed);
  });

  it("h. input NaN, Infinity, lat 200, atau accuracy negatif tidak melempar error dan hasil tetap terhingga", () => {
    const tracker = createSpeedTracker();
    const t0 = 7_000_000;

    expect(() =>
      tracker.update(
        { lat: NaN, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 },
        t0
      )
    ).not.toThrow();
    expect(tracker.getSpeed(t0)).toBe(0);

    let validSpeed = 0;
    for (let t = 0; t <= 12; t++) {
      const pos = offsetMeters(BASE_LAT, BASE_LON, t * 4.0, 0);
      const ts = t0 + t * 1000;
      validSpeed = tracker.update(
        { lat: pos.lat, lon: pos.lon, accuracy_m: 5, timestamp_ms: ts },
        ts
      );
    }
    expect(validSpeed).toBeGreaterThan(0);

    const invalidInputs = [
      { lat: NaN, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 + 20_000 },
      {
        lat: BASE_LAT,
        lon: Infinity,
        accuracy_m: 5,
        timestamp_ms: t0 + 20_000,
      },
      {
        lat: BASE_LAT,
        lon: BASE_LON,
        accuracy_m: -1,
        timestamp_ms: t0 + 20_000,
      },
      {
        lat: BASE_LAT,
        lon: BASE_LON,
        accuracy_m: -Infinity,
        timestamp_ms: t0 + 20_000,
      },
      { lat: 200, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 + 20_000 },
      { lat: -95, lon: BASE_LON, accuracy_m: 5, timestamp_ms: t0 + 20_000 },
      { lat: BASE_LAT, lon: 190, accuracy_m: 5, timestamp_ms: t0 + 20_000 },
      { lat: BASE_LAT, lon: BASE_LON, accuracy_m: 5, timestamp_ms: NaN },
    ];

    for (const bad of invalidInputs) {
      const res = tracker.update(bad, t0 + 20_000);
      expect(Number.isFinite(res)).toBe(true);
      expect(res).toBe(validSpeed);
    }

    expect(Number.isFinite(tracker.getSpeed(NaN))).toBe(true);
    expect(tracker.getSpeed(NaN)).toBe(0);
  });

  it("i. stale: setelah urutan jalan hingga speed > 0, getSpeed() tepat 5 detik masih segar dan > 5 detik = 0", () => {
    const tracker = createSpeedTracker();
    const t0 = 8_000_000;

    let lastSpeed = 0;
    let lastTs = t0;
    for (let t = 0; t <= 15; t++) {
      const pos = offsetMeters(BASE_LAT, BASE_LON, t * 3.0, 0);
      lastTs = t0 + t * 1000;
      lastSpeed = tracker.update(
        { lat: pos.lat, lon: pos.lon, accuracy_m: 5, timestamp_ms: lastTs },
        lastTs
      );
    }
    expect(lastSpeed).toBeGreaterThan(0);

    // Tepat 5 detik masih segar
    expect(tracker.getSpeed(lastTs + 5000)).toBe(lastSpeed);

    // Lebih dari 5 detik dianggap stale -> 0
    expect(tracker.getSpeed(lastTs + 5001)).toBe(0);
    expect(tracker.getSpeed(lastTs + 10_000)).toBe(0);
  });

  it("j. diam 30 detik lalu jalan 1.4 m/s: speed > 0.5 dalam 15 detik setelah mulai jalan (laporkan 10s, 15s, 20s)", () => {
    const numSeeds = 30;
    const speedsAt10: number[] = [];
    const speedsAt15: number[] = [];
    const speedsAt20: number[] = [];

    for (let seed = 1; seed <= numSeeds; seed++) {
      const rng = createPrng(5000 + seed);
      const tracker = createSpeedTracker();
      const startTs = 9_000_000;

      for (let t = 0; t <= 50; t++) {
        const walked = Math.max(0, t - 30) * 1.4;
        const px = rng.uniform(-4, 4);
        const py = rng.uniform(-4, 4);
        const pos = offsetMeters(BASE_LAT, BASE_LON, walked + py, px);
        const ts = startTs + t * 1000;
        const nat = t < 30 ? 0.03 : 1.4 + rng.gauss(0, 0.2);
        const v = tracker.update(
          {
            lat: pos.lat,
            lon: pos.lon,
            accuracy_m: 8.0,
            timestamp_ms: ts,
          },
          ts,
          nat
        );

        const walkSec = t - 30;
        if (walkSec === 10) speedsAt10.push(v);
        if (walkSec === 15) speedsAt15.push(v);
        if (walkSec === 20) speedsAt20.push(v);
      }
    }

    const mean10 = speedsAt10.reduce((a, b) => a + b, 0) / numSeeds;
    const mean15 = speedsAt15.reduce((a, b) => a + b, 0) / numSeeds;
    const mean20 = speedsAt20.reduce((a, b) => a + b, 0) / numSeeds;

    console.info(
      `[Test j] Stop 30s then walk 1.4 m/s: 10s=${mean10.toFixed(
        3
      )} m/s, 15s=${mean15.toFixed(3)} m/s, 20s=${mean20.toFixed(3)} m/s`
    );

    expect(mean15).toBeGreaterThan(0.5);
    for (const v15 of speedsAt15) {
      expect(v15).toBeGreaterThan(0.5);
    }
  });

  it("k. gerbang Doppler: nativeSpeed < 0.5 membuat keluaran meluruh < 0.05 dalam 10 update walau posisi berfluktuasi; nativeSpeed null memakai estimator jendela", () => {
    const tracker = createSpeedTracker();
    const rng = createPrng(777);
    const t0 = 10_000_000;

    // 1. Bangun kecepatan terlebih dahulu dengan nativeSpeed null (memakai estimator jendela)
    let windowSpeed = 0;
    for (let t = 0; t <= 15; t++) {
      const pos = offsetMeters(BASE_LAT, BASE_LON, t * 4.0, 0);
      const ts = t0 + t * 1000;
      windowSpeed = tracker.update(
        { lat: pos.lat, lon: pos.lon, accuracy_m: 6.0, timestamp_ms: ts },
        ts,
        null
      );
    }
    expect(windowSpeed).toBeGreaterThan(2.0);

    // 2. Sekarang beri 10 update dengan posisi tetap berfluktuasi/bergerak namun nativeSpeed < 0.5
    let gatedSpeed = windowSpeed;
    for (let k = 1; k <= 10; k++) {
      const flucNorth = 15 * 4.0 + rng.uniform(-12, 12);
      const flucEast = rng.uniform(-12, 12);
      const pos = offsetMeters(BASE_LAT, BASE_LON, flucNorth, flucEast);
      const ts = t0 + (15 + k) * 1000;
      gatedSpeed = tracker.update(
        { lat: pos.lat, lon: pos.lon, accuracy_m: 6.0, timestamp_ms: ts },
        ts,
        0.1
      );
    }
    expect(gatedSpeed).toBeLessThan(0.05);

    // 3. Saat nativeSpeed kembali null, keluaran kembali mengikuti ema estimator jendela (> 0.5)
    const resumePos = offsetMeters(BASE_LAT, BASE_LON, 26 * 4.0, 0);
    const resumedSpeed = tracker.update(
      {
        lat: resumePos.lat,
        lon: resumePos.lon,
        accuracy_m: 6.0,
        timestamp_ms: t0 + 26 * 1000,
      },
      t0 + 26 * 1000,
      null
    );
    expect(resumedSpeed).toBeGreaterThan(0.5);
  });

  it("l. reset() mengembalikan semua keadaan ke awal", () => {
    const tracker = createSpeedTracker();
    const t0 = 11_000_000;

    let speed = 0;
    for (let t = 0; t <= 15; t++) {
      const pos = offsetMeters(BASE_LAT, BASE_LON, t * 4.0, 0);
      const ts = t0 + t * 1000;
      speed = tracker.update(
        { lat: pos.lat, lon: pos.lon, accuracy_m: 5.0, timestamp_ms: ts },
        ts
      );
    }
    expect(speed).toBeGreaterThan(0);

    tracker.reset();
    expect(tracker.getSpeed(t0 + 15_000)).toBe(0);

    // Pembacaan pertama setelah reset harus kembali 0 meskipun timestamp lebih kecil dari sebelum reset
    expect(
      tracker.update(
        { lat: BASE_LAT, lon: BASE_LON, accuracy_m: 5.0, timestamp_ms: 1000 },
        1000
      )
    ).toBe(0);
  });
});
