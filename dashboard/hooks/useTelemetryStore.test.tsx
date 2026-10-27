
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
});
