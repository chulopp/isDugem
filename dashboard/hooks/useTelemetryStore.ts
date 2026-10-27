"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Alert,
  AnakTelemetry,
  OrtuTelemetry,
  SystemEventLog,
  TelemetryHistoryPoint,
  TimeLabel,
  TimeMode,
} from "@/lib/types";
import {
  computeDistancesToCategories,
  getRealtimeTimeLabel,
  haversineDistanceM,
} from "@/lib/mqttTopics";

function formatClock(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function useTelemetryStore() {
  const [timeMode, setTimeMode] = useState<TimeMode>("auto");
  const [activeTimeLabel, setActiveTimeLabel] = useState<TimeLabel>(() =>
    getRealtimeTimeLabel()
  );

  const [latestTelemetry, setLatestTelemetry] = useState<AnakTelemetry>({
    device_id: "anak",
    sequence: 0,
    sent_at_ms: 0,
    location: {
      lat: -7.0502,
      lon: 110.4398,
      accuracy_m: 0,
    },
    audio: {
      rms: 0,
      db: 0,
    },
    motion: {
      accel_magnitude: 0,
    },
  });

  const [latestOrtuTelemetry, setLatestOrtuTelemetry] =
    useState<OrtuTelemetry | null>(null);

  const [latestAlert, setLatestAlert] = useState<Alert>({
    status: "NORMAL",
    reason: "Menunggu alert resmi dari backend.",
    timestamp_ms: 0,
    context: {
      time_label: "lainnya",
      nearest_poi: "kampus",
      distance_m: 0,
      db: 0,
    },
  });

  const [history, setHistory] = useState<TelemetryHistoryPoint[]>([]);
  const [events, setEvents] = useState<SystemEventLog[]>([]);

  const [trailCoords, setTrailCoords] = useState<[number, number][]>([]);
  const [activeRouteCoords, setActiveRouteCoords] = useState<
    [number, number][]
  >([]);
  const [speedKmh, setSpeedKmh] = useState<number>(0);

  const prevLocRef = useRef<{
    lat: number;
    lon: number;
    time: number;
    sequence?: number;
  } | null>(null);
  const timeModeRef = useRef<TimeMode>("auto");
  const activeTimeLabelRef = useRef<TimeLabel>(getRealtimeTimeLabel());

  // Sinkronisasi jam real-time saat mode "auto" aktif
  useEffect(() => {
    const tick = () => {
      if (timeModeRef.current === "auto") {
        const realLabel = getRealtimeTimeLabel(new Date());
        if (realLabel !== activeTimeLabelRef.current) {
          activeTimeLabelRef.current = realLabel;
          setActiveTimeLabel(realLabel);
        }
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  const updateTimeMode = useCallback((mode: TimeMode) => {
    timeModeRef.current = mode;
    setTimeMode(mode);
    const resolvedLabel: TimeLabel =
      mode === "auto" ? getRealtimeTimeLabel(new Date()) : mode;
    activeTimeLabelRef.current = resolvedLabel;
    setActiveTimeLabel(resolvedLabel);
  }, []);

  const addEventLog = useCallback(
    (item: Omit<SystemEventLog, "id" | "time" | "timestamp_ms">) => {
      const now = Date.now();
      const newLog: SystemEventLog = {
        ...item,
        id: `evt-${now}-${Math.random().toString(36).slice(2, 6)}`,
        time: formatClock(now),
        timestamp_ms: now,
      };
      setEvents((prev) => [newLog, ...prev].slice(0, 40));
    },
    []
  );

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const ingestAnakTelemetry = useCallback(
    (
      payload: AnakTelemetry,
      timeOverride?: TimeLabel,
      tripContext?: { destinationName: string; distanceToDestM: number }
    ) => {
      const now = payload.sent_at_ms || Date.now();

      // Abaikan duplikat persis dari sequence yang sama (misal loopback broker MQTT)
      if (
        prevLocRef.current &&
        payload.sequence > 0 &&
        prevLocRef.current.sequence === payload.sequence
      ) {
        return;
      }

      if (timeOverride) {
        timeModeRef.current = timeOverride;
        setTimeMode(timeOverride);
        activeTimeLabelRef.current = timeOverride;
        setActiveTimeLabel(timeOverride);
      } else if (timeModeRef.current === "auto") {
        const tLabel = getRealtimeTimeLabel(new Date());
        activeTimeLabelRef.current = tLabel;
        setActiveTimeLabel(tLabel);
      }

      const prev = prevLocRef.current;
      if (prev) {
        const distMovedM = haversineDistanceM(
          prev.lat,
          prev.lon,
          payload.location.lat,
          payload.location.lon
        );
        const dtSec = Math.max(0.5, (now - prev.time) / 1000);
        const calcSpeed =
          distMovedM > 1.2
            ? Math.min(95, Math.round((distMovedM / dtSec) * 3.6))
            : 0;
        setSpeedKmh(calcSpeed);
      } else {
        setSpeedKmh(0);
      }

      prevLocRef.current = {
        lat: payload.location.lat,
        lon: payload.location.lon,
        time: now,
        sequence: payload.sequence,
      };

      setLatestTelemetry(payload);

      setTrailCoords((prevTrail) => {
        const last = prevTrail[prevTrail.length - 1];
        if (
          !last ||
          haversineDistanceM(
            last[0],
            last[1],
            payload.location.lat,
            payload.location.lon
          ) > 3
        ) {
          return [
            ...prevTrail.slice(-50),
            [payload.location.lat, payload.location.lon],
          ];
        }
        return prevTrail;
      });

      const { nearestSpot, nearestSpotDist } = computeDistancesToCategories(
        payload.location.lat,
        payload.location.lon
      );

      const resolvedDistance =
        tripContext && tripContext.distanceToDestM !== undefined
          ? Math.round(tripContext.distanceToDestM)
          : Math.round(nearestSpotDist);

      const resolvedPoi =
        tripContext && tripContext.destinationName
          ? tripContext.destinationName
          : nearestSpot.name;

      const newPoint: TelemetryHistoryPoint = {
        time: formatClock(now),
        timestamp_ms: now,
        db: Number(payload.audio.db.toFixed(1)),
        distance_m: resolvedDistance,
        nearest_poi: resolvedPoi,
      };

      setHistory((prevHist) => [...prevHist.slice(-59), newPoint]);
    },
    []
  );

  const ingestOrtuTelemetry = useCallback(
    (payload: OrtuTelemetry) => {
      setLatestOrtuTelemetry(payload);
      if (payload.motion?.shake_detected) {
        addEventLog({
          sender: "Perangkat Orang Tua",
          role: "ortu",
          title: "Shake-to-Ping Aktif",
          message: `Sensor gerak mendeteksi guncangan (${payload.motion.accel_magnitude.toFixed(
            1
          )} m/s²). Mengirim ping ke perangkat anak.`,
          severity: "info",
          meta: "Edge Device 2",
        });
      }
    },
    [addEventLog]
  );

  const ingestServerAlert = useCallback(
    (alertPayload: Alert) => {
      setLatestAlert((prevAlert) => {
        if (
          prevAlert.status !== alertPayload.status ||
          prevAlert.timestamp_ms === 0
        ) {
          const sev =
            alertPayload.status === "ANOMALY_FAKE_GPS" ||
            alertPayload.status === "CRITICAL_TERDETEKSI_DI_BAR"
              ? "critical"
              : alertPayload.status === "ALERT_BOLOS_KULIAH" ||
                alertPayload.status === "WARNING_BELUM_KE_MASJID"
              ? "warning"
              : "normal";

          addEventLog({
            sender: "Server Decision Engine",
            role: "server",
            title: alertPayload.status,
            message: alertPayload.reason,
            severity: sev,
            meta: `Jarak ${alertPayload.context?.distance_m ?? 0} m`,
          });
        }
        return alertPayload;
      });
    },
    [addEventLog]
  );

  const clearTrail = useCallback((startCoord: [number, number]) => {
    setTrailCoords([startCoord]);
  }, []);

  return {
    timeMode,
    activeTimeLabel,
    updateTimeMode,
    latestTelemetry,
    latestOrtuTelemetry,
    latestAlert,
    history,
    events,
    clearEvents,
    trailCoords,
    activeRouteCoords,
    setActiveRouteCoords,
    clearTrail,
    speedKmh,
    ingestAnakTelemetry,
    ingestOrtuTelemetry,
    ingestServerAlert,
    addEventLog,
  };
}
