
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTelemetryStore } from "./useTelemetryStore";
import type { Alert, AnakTelemetry } from "@/lib/types";

afterEach(() => {
  cleanup();
});

function makeAlert(
  status: Alert["status"],
  timestamp_ms: number,
  reason = `Status ${status}`
): Alert {
  return {
    status,
    reason,
    timestamp_ms,
    context: {
      time_label: "jam_kuliah",
      nearest_poi: "kampus",
      distance_m: 120,
      db: 40,
    },
  };
}

function makeTelemetry(): AnakTelemetry {
  return {
    device_id: "anak",
    sequence: 1,
    sent_at_ms: 1_800_000_000_000,
    location: {
      lat: -7.0502,
      lon: 110.4398,
      accuracy_m: 5,
    },
    audio: {
      rms: 0.01,
      db: 40,
    },
    motion: {
      accel_magnitude: 9.8,
    },
  };
}

describe("useTelemetryStore: alert backend", () => {
  it("menerima alert pertama dan membuat event log", () => {
    const { result } = renderHook(() => useTelemetryStore());
    const alert = makeAlert("ALERT_BOLOS_KULIAH", 1000);

    act(() => {
      result.current.ingestServerAlert(alert);
    });

    expect(result.current.latestAlert).toEqual(alert);
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0]).toMatchObject({
      sender: "Server Decision Engine",
      role: "server",
      title: "ALERT_BOLOS_KULIAH",
      message: alert.reason,
      severity: "warning",
      meta: "Jarak 120 m",
    });
  });

  it("mencatat perubahan status backend", () => {
    const { result } = renderHook(() => useTelemetryStore());

    act(() => {
      result.current.ingestServerAlert(
        makeAlert("SEDANG_KULIAH", 1000)
      );
      result.current.ingestServerAlert(
        makeAlert("CRITICAL_TERDETEKSI_DI_BAR", 2000)
      );
    });

    expect(result.current.latestAlert.status).toBe(
      "CRITICAL_TERDETEKSI_DI_BAR"
    );
    expect(result.current.events).toHaveLength(2);
    expect(result.current.events[0].severity).toBe("critical");
  });

  it("tidak membuat log duplikat untuk status yang sama", () => {
    const { result } = renderHook(() => useTelemetryStore());

    act(() => {
      result.current.ingestServerAlert(
        makeAlert("SEDANG_KULIAH", 1000, "Alert pertama")
      );
      result.current.ingestServerAlert(
        makeAlert("SEDANG_KULIAH", 2000, "Alert berulang")
      );
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.latestAlert.reason).toBe("Alert berulang");
    expect(result.current.latestAlert.timestamp_ms).toBe(2000);
  });

  it("tidak menimpa status backend ketika telemetry anak masuk", () => {
    const { result } = renderHook(() => useTelemetryStore());
    const backendAlert = makeAlert(
      "CRITICAL_TERDETEKSI_DI_BAR",
      1000
    );

    act(() => {
      result.current.ingestServerAlert(backendAlert);
    });

    act(() => {
      result.current.ingestAnakTelemetry(makeTelemetry());
    });

    expect(result.current.latestAlert).toEqual(backendAlert);
    expect(result.current.latestTelemetry.sequence).toBe(1);
    expect(result.current.events).toHaveLength(1);
  });

  it("memisahkan data lokasi telemetri terbaru dari alert backend lama", () => {
    const { result } = renderHook(() => useTelemetryStore());
    const initialAlert = makeAlert("WARNING_BELUM_KE_MASJID", 1000, "Jarak ke masjid 297m");

    act(() => {
      result.current.ingestServerAlert(initialAlert);
    });

    // Anak bergerak ke lokasi baru
    const newTelemetry = makeTelemetry();
    newTelemetry.sequence = 2;
    newTelemetry.location.lat = -6.968; // Area bar Kota Lama
    newTelemetry.location.lon = 110.4285;

    act(() => {
      result.current.ingestAnakTelemetry(newTelemetry);
    });

    // Koordinat telemetri terbaru harus diperbarui
    expect(result.current.latestTelemetry.location.lat).toBe(-6.968);
    expect(result.current.latestTelemetry.sequence).toBe(2);
    // Namun status alert backend tetap tidak diubah oleh client-side guessing
    expect(result.current.latestAlert.status).toBe("WARNING_BELUM_KE_MASJID");
    expect(result.current.latestAlert.reason).toBe("Jarak ke masjid 297m");
  });

  it("membaca location.speed_mps dan mengonversi ke km/j tanpa lonjakan palsu", () => {
    const { result } = renderHook(() => useTelemetryStore());

    // 1. Awal tanpa speed_mps -> null
    const tel1 = makeTelemetry();
    act(() => {
      result.current.ingestAnakTelemetry(tel1);
    });
    expect(result.current.speedMps).toBeNull();
    expect(result.current.speedKmh).toBeNull();

    // 2. Paket kedua menyertakan speed_mps: 4.5 m/s (16.2 km/j)
    const tel2 = makeTelemetry();
    tel2.sequence = 2;
    tel2.location.speed_mps = 4.5;
    act(() => {
      result.current.ingestAnakTelemetry(tel2);
    });
    expect(result.current.speedMps).toBe(4.5);
    expect(result.current.speedKmh).toBe(16.2);

    // 3. Paket ketiga lompat koordinat jauh (simulasi lompat preset) tetapi speed_mps: 0 -> tetap 0
    const tel3 = makeTelemetry();
    tel3.sequence = 3;
    tel3.location.lat = -6.968; // Area bar (jauh dari kampus)
    tel3.location.lon = 110.4285;
    tel3.location.speed_mps = 0;
    act(() => {
      result.current.ingestAnakTelemetry(tel3);
    });
    expect(result.current.speedMps).toBe(0);
    expect(result.current.speedKmh).toBe(0);
  });

  it("mencatat metadata ML dan skor Isolation Forest pada event log", () => {
    const { result } = renderHook(() => useTelemetryStore());
    const mlAlert: Alert = {
      status: "CRITICAL_TERDETEKSI_DI_BAR",
      reason: "Probabilitas ML 95.8%: Dekat bar",
      timestamp_ms: 5000,
      context: {
        time_label: "jam_malam",
        nearest_poi: "bar",
        distance_m: 42,
        db: 82,
      },
      ml_meta: {
        engine: "RandomForest+IsolationForest",
        confidence: 0.958,
        anomaly_score: -0.045,
        is_anomaly: true,
      },
    };

    act(() => {
      result.current.ingestServerAlert(mlAlert);
    });

    expect(result.current.latestAlert.ml_meta).toEqual(mlAlert.ml_meta);
    expect(result.current.events[0]).toMatchObject({
      sender: "Server ML Engine",
      role: "server",
      title: "CRITICAL_TERDETEKSI_DI_BAR",
      message: mlAlert.reason,
      severity: "critical",
      meta: "ML 95.8% | Anomali IF | Jarak 42 m",
    });
  });
});
