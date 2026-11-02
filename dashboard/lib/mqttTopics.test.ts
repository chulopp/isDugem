import { describe, expect, it } from "vitest";
import {
  SERVER_POI_CENTERS,
  computeDistancesToServerPois,
  evaluateTelemetryLocally,
} from "./mqttTopics";

describe("mqttTopics: geofence server dan evaluateTelemetryLocally", () => {
  it("menghitung jarak ke pusat POI server secara akurat", () => {
    // Pada titik pusat kampus server (-7.0502, 110.4398)
    const dists = computeDistancesToServerPois(-7.0502, 110.4398);
    expect(Math.round(dists.distKampus)).toBe(0);
    expect(dists.distMasjid).toBeGreaterThan(500);
    expect(dists.distKos).toBeGreaterThan(1000);
  });

  it("mendeteksi titik tepi (-7.0655, 110.4330) sebagai dalam zona kos server 750m", () => {
    // Catatan Wendi: (-7.0655, 110.4330) berada ~659m dari pusat kos server (-7.0632, 110.4385)
    const dists = computeDistancesToServerPois(-7.0655, 110.433);
    expect(dists.distKos).toBeLessThanOrEqual(SERVER_POI_CENTERS.kos.radius_m);
    expect(Math.round(dists.distKos)).toBeCloseTo(659, -1);

    const alert = evaluateTelemetryLocally(
      -7.0655,
      110.433,
      45.0,
      "jam_malam"
    );
    expect(alert.status).toBe("ISTIRAHAT_DI_KOS");
  });

  it("mendeteksi titik tepi (-7.0720, 110.439708) sebagai di luar zona kos server 750m", () => {
    // Catatan Wendi: (-7.0720, 110.439708) berada ~987m dari pusat kos server (-7.0632, 110.4385)
    const dists = computeDistancesToServerPois(-7.072, 110.439708);
    expect(dists.distKos).toBeGreaterThan(SERVER_POI_CENTERS.kos.radius_m);
    expect(Math.round(dists.distKos)).toBeCloseTo(987, -1);

    const alert = evaluateTelemetryLocally(
      -7.072,
      110.439708,
      45.0,
      "jam_malam"
    );
    expect(alert.status).toBe("NORMAL");
  });
});
