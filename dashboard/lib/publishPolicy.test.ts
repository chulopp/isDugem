import { describe, expect, it } from "vitest";
import {
  getAudioZone,
  shouldPublishOnAudioEvent,
  shouldPublishOnPeriodicTick,
} from "./publishPolicy";

interface SimResult {
  sentTotal: number;
  sentPeriodic: number;
  sentEvent: number;
  publishTimestampsMs: number[];
}

/**
 * Simulator loop pengiriman telemetri /anak:
 * - Start pada t = 0 ms mengirim 1 paket awal (periodic)
 * - Tick audio setiap 200 ms mengevaluasi shouldPublishOnAudioEvent
 * - Tick periodik setiap 1000 ms mengevaluasi shouldPublishOnPeriodicTick
 */
function simulatePublishLoop(
  durationS: number,
  dbAtTimeMs: (tMs: number) => number
): SimResult {
  let lastPublishMs = 0;
  let lastPublishedDb = dbAtTimeMs(0);
  let lastPublishedZone = getAudioZone(lastPublishedDb);

  let sentPeriodic = 1; // Paket awal saat Start (t = 0)
  let sentEvent = 0;
  const publishTimestampsMs: number[] = [0];

  const totalMs = durationS * 1000;
  for (let tMs = 200; tMs <= totalMs; tMs += 200) {
    const effectiveDb = dbAtTimeMs(tMs);

    // 1. Evaluasi loop audio 200 ms
    if (
      shouldPublishOnAudioEvent({
        effectiveDb,
        lastPublishedDb,
        lastPublishedZone,
        nowMs: tMs,
        lastPublishMs,
      })
    ) {
      lastPublishMs = tMs;
      lastPublishedDb = effectiveDb;
      lastPublishedZone = getAudioZone(effectiveDb);
      sentEvent += 1;
      publishTimestampsMs.push(tMs);
    }

    // 2. Evaluasi timer periodik setiap kelipatan 1000 ms
    if (tMs % 1000 === 0) {
      if (shouldPublishOnPeriodicTick(tMs, lastPublishMs)) {
        lastPublishMs = tMs;
        lastPublishedDb = effectiveDb;
        lastPublishedZone = getAudioZone(effectiveDb);
        sentPeriodic += 1;
        publishTimestampsMs.push(tMs);
      }
    }
  }

  return {
    sentTotal: sentPeriodic + sentEvent,
    sentPeriodic,
    sentEvent,
    publishTimestampsMs,
  };
}

describe("publishPolicy", () => {
  it("dB senyap berosilasi 54.8 <-> 55.2 selama 60 detik -> kejadian = 0 dan total paket dalam 55-65 (~60)", () => {
    const sim = simulatePublishLoop(60, (tMs) => {
      const step = Math.floor(tMs / 200);
      return step % 2 === 0 ? 54.8 : 55.2;
    });

    expect(sim.sentEvent).toBe(0);
    expect(sim.sentTotal).toBeGreaterThanOrEqual(55);
    expect(sim.sentTotal).toBeLessThanOrEqual(65);
  });

  it("naik jelas dari 50 ke 70 dB -> memicu tepat satu paket kejadian dengan jeda >= 500 ms", () => {
    // 0..10 dtk: 50 dB; mulai 10.6 dtk (600 ms setelah publish periodik t=10000): naik ke 70 dB dan bertahan
    const sim = simulatePublishLoop(20, (tMs) => (tMs >= 10600 ? 70.0 : 50.0));

    expect(sim.sentEvent).toBe(1);
    for (let i = 1; i < sim.publishTimestampsMs.length; i++) {
      const gap = sim.publishTimestampsMs[i] - sim.publishTimestampsMs[i - 1];
      expect(gap).toBeGreaterThanOrEqual(500);
    }
  });

  it("lonjakan >= 6 dB (meskipun di dalam zona yang sama) memicu paket kejadian", () => {
    // 56.0 dB -> 62.0 dB sama-sama di Zona 1 (55..65), tetapi selisih 6.0 dB
    expect(
      shouldPublishOnAudioEvent({
        effectiveDb: 62.0,
        lastPublishedDb: 56.0,
        lastPublishedZone: getAudioZone(56.0),
        nowMs: 1600,
        lastPublishMs: 1000,
      })
    ).toBe(true);

    // Selisih 5.9 dB di zona yang sama tidak memicu
    expect(
      shouldPublishOnAudioEvent({
        effectiveDb: 61.9,
        lastPublishedDb: 56.0,
        lastPublishedZone: getAudioZone(56.0),
        nowMs: 1600,
        lastPublishMs: 1000,
      })
    ).toBe(false);
  });

  it("tidak pernah ada dua paket dengan selisih < 500 ms pada berbagai fluktuasi suara ekstrem", () => {
    // Skenario ekstrem: dB melompat-lompat tiap 200 ms (48 -> 85 -> 50 -> 90 -> 54.8 -> 55.2)
    const pattern = [48.0, 85.0, 50.0, 90.0, 54.8, 55.2, 66.0, 78.0];
    const sim = simulatePublishLoop(60, (tMs) => {
      const idx = Math.floor(tMs / 200) % pattern.length;
      return pattern[idx];
    });

    for (let i = 1; i < sim.publishTimestampsMs.length; i++) {
      const gap = sim.publishTimestampsMs[i] - sim.publishTimestampsMs[i - 1];
      expect(gap).toBeGreaterThanOrEqual(500);
    }
  });
});
