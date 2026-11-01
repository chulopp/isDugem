"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  MapPin,
  Mic,
  Activity,
  Lock,
  Play,
  Square,
  BellRing,
  Clock,
  Navigation,
  Radio,
} from "lucide-react";
import { useMqtt } from "@/hooks/useMqtt";
import {
  MQTT_TOPICS,
  POI_SPOTS,
  haversineDistanceM,
} from "@/lib/mqttTopics";
import { AnakTelemetry, OrtuTelemetry, TimeMode } from "@/lib/types";
import { createSpeedTracker } from "@/lib/speed";
import {
  AudioMode,
  AudioSettingsSnapshot,
  computeConsistentRms,
  resolveEffectiveSpeedMps,
  resolveTelemetryTimestampMs,
  SensorSnapshotInput,
} from "@/lib/fieldRecorder";
import FieldRecorder from "@/components/FieldRecorder";

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

interface PerformanceMemoryLike {
  usedJSHeapSize: number;
  totalJSHeapSize?: number;
  jsHeapSizeLimit?: number;
}

interface DebugSnapshot {
  sentCount: number;
  skippedCount: number;
  disconnectCount: number;
  avgIntervalMs: number | null;
  maxGapMs: number;
  sessionElapsedS: number;
  heapUsedMb: number | null;
  speedMps: number;
  nativeSpeed: number | null;
  lastAccuracyM: number;
  gpsFixAgeS: number | null;
  audioMode: AudioMode;
  audioSettings: AudioSettingsSnapshot;
}

const SESSION_TARGET_S = 30 * 60; // 30 menit target sesi uji stabilitas

function getAudioZone(db: number): number {
  if (db < 55.0) return 0;
  if (db < 65.0) return 1;
  if (db <= 75.0) return 2;
  if (db <= 80.0) return 3;
  return 4;
}

function formatDurationMmSs(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function AnakEdgePage() {
  const [sensorActive, setSensorActive] = useState(false);
  const [sequence, setSequence] = useState(0);

  // State Sensor Anak (3 Sensor: GPS, Mikrofon, Akselerometer)
  const [gpsCoords, setGpsCoords] = useState({
    lat: -7.0502,
    lon: 110.4398,
    accuracy_m: 8.0,
  });
  const [audioData, setAudioData] = useState({ rms: 0.012, db: 48.0 });
  const [accelMag, setAccelMag] = useState(9.8);
  const [accelAvailable, setAccelAvailable] = useState(true);
  const [speedMps, setSpeedMps] = useState(0);

  // Status izin mikrofon & Wake Lock
  const [micErrorNotice, setMicErrorNotice] = useState<string | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  // Telemetri Lokasi & Gerak Orang Tua dari MQTT
  const [latestOrtu, setLatestOrtu] = useState<OrtuTelemetry | null>(null);

  // Mode Kunci Koordinat Demo ("gps_asli" atau id dari POI_SPOTS)
  const [lockedSpotId, setLockedSpotId] = useState<string>("gps_asli");

  // Mode Waktu Simulasi ("auto" atau id jadwal)
  const [simulatedTimeMode, setSimulatedTimeMode] = useState<TimeMode>("auto");
  const [timeSyncNotice, setTimeSyncNotice] = useState<string | null>(null);

  // Peringatan/Perintah Masuk
  const [incomingCommand, setIncomingCommand] = useState<{
    type: string;
    message: string;
    time: string;
  } | null>(null);

  // Panel Diagnostik (?debug=1), Mode Perekaman (?record=1), & Mode Audio Mentah (?raw_audio=1)
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [isRecordMode, setIsRecordMode] = useState(false);
  const isDebugModeRef = useRef(false);
  const isRawAudioModeRef = useRef(false);
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot>({
    sentCount: 0,
    skippedCount: 0,
    disconnectCount: 0,
    avgIntervalMs: null,
    maxGapMs: 0,
    sessionElapsedS: 0,
    heapUsedMb: null,
    speedMps: 0,
    nativeSpeed: null,
    lastAccuracyM: 8.0,
    gpsFixAgeS: null,
    audioMode: "default",
    audioSettings: {
      echoCancellation: null,
      noiseSuppression: null,
      autoGainControl: null,
    },
  });

  const stateRef = useRef({
    lat: -7.0502,
    lon: 110.4398,
    accuracy_m: 8.0,
    realLat: -7.0502,
    realLon: 110.4398,
    realAcc: 8.0,
    nativeSpeed: null as number | null,
    lastGpsFixReceivedMs: null as number | null,
    rms: 0.012,
    db: 48.0,
    accel: 9.8,
    seq: Math.floor(Date.now() / 200),
    localCount: 0,
    lockedSpotId: "gps_asli",
    timeMode: "auto" as TimeMode,
    peakDb: 48.0,
    peakHoldUntilMs: 0,
    presetDbLockUntilMs: 0,
    audioMode: "default" as AudioMode,
    audioSettings: {
      echoCancellation: null,
      noiseSuppression: null,
      autoGainControl: null,
    } as AudioSettingsSnapshot,
  });

  // Ring buffer ukuran tetap (maksimal 10 interval publish terakhir) & agregat berjalan
  const diagStatsRef = useRef({
    sessionStartMs: null as number | null,
    sentCount: 0,
    skippedCount: 0,
    disconnectCount: 0,
    intervalsRing: new Float64Array(10),
    ringIndex: 0,
    ringCount: 0,
    maxGapMs: 0,
    lastUiUpdateMs: 0,
  });
  const prevConnectedRef = useRef<boolean>(false);

  const lastPublishMsRef = useRef<number>(0);
  const lastPublishedDbRef = useRef<number>(48.0);
  const lastPublishedZoneRef = useRef<number>(getAudioZone(48.0));
  const publishTelemetryNowRef = useRef<() => void>(() => {});
  const speedTrackerRef = useRef(createSpeedTracker());
  const lastSpeedUiUpdateMsRef = useRef<number>(0);

  // Guard anti-reentrancy untuk startSensors/stopSensors
  const sensorRunningRef = useRef<boolean>(false);
  const sensorStartingRef = useRef<boolean>(false);

  // Refs untuk resource hardware, timer, dan AudioContext bersama
  const watchIdRef = useRef<number | null>(null);
  const audioIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pubIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const alertAudioCtxRef = useRef<AudioContext | null>(null);
  const timeSyncTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const motionHandlerRef = useRef<((ev: DeviceMotionEvent) => void) | null>(null);

  // Deteksi ?debug=1, ?record=1, dan ?raw_audio=1 dari window.location.search di dalam useEffect (tanpa useSearchParams/Suspense)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const debugOn = params.get("debug") === "1";
      const rawAudioOn = params.get("raw_audio") === "1";
      isDebugModeRef.current = debugOn;
      isRawAudioModeRef.current = rawAudioOn;
      stateRef.current.audioMode = rawAudioOn ? "raw" : "default";
      setIsDebugMode(debugOn);
      setIsRecordMode(params.get("record") === "1");
      if (debugOn) {
        setDebugSnapshot((prev) => ({
          ...prev,
          audioMode: rawAudioOn ? "raw" : "default",
        }));
      }
    }
  }, []);

  // Satu AudioContext bersama (lazy) untuk nada peringatan masuk
  const playAlertTone = useCallback((isAlarm: boolean) => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;

      let ctx = alertAudioCtxRef.current;
      if (!ctx || ctx.state === "closed") {
        ctx = new AudioCtx();
        alertAudioCtxRef.current = ctx;
      }
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const duration = isAlarm ? 0.9 : 0.45;
      const now = ctx.currentTime;

      osc.type = isAlarm ? "sawtooth" : "sine";
      osc.frequency.setValueAtTime(isAlarm ? 880 : 587.33, now);
      if (isAlarm) {
        osc.frequency.setValueAtTime(660, now + 0.25);
        osc.frequency.setValueAtTime(880, now + 0.5);
      }

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        try {
          osc.disconnect();
        } catch {
          // Ignore disconnect error
        }
        try {
          gain.disconnect();
        } catch {
          // Ignore disconnect error
        }
      };

      osc.start(now);
      osc.stop(now + duration);
    } catch {
      // Ignore audio play restriction
    }
  }, []);

  const acquireWakeLock = useCallback(async () => {
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }
    try {
      if (wakeLockRef.current && !wakeLockRef.current.released) {
        setWakeLockActive(true);
        return;
      }
      const wakeLockApi = (
        navigator as Navigator & {
          wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> };
        }
      ).wakeLock;
      if (!wakeLockApi) return;

      const sentinel = await wakeLockApi.request("screen");
      if (!sensorRunningRef.current) {
        await sentinel.release().catch(() => {});
        return;
      }
      wakeLockRef.current = sentinel;
      setWakeLockActive(true);
      sentinel.addEventListener?.("release", () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null;
          setWakeLockActive(false);
        }
      });
    } catch {
      setWakeLockActive(false);
    }
  }, []);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    setWakeLockActive(false);
    if (sentinel) {
      try {
        await sentinel.release();
      } catch {
        // Ignore release error
      }
    }
  }, []);

  // Re-acquire Wake Lock saat tab kembali visible jika sensor masih aktif
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        sensorRunningRef.current
      ) {
        acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [acquireWakeLock]);

  const handleAnakTelemetry = useCallback((payload: AnakTelemetry) => {
    if (payload.sequence && payload.sequence > stateRef.current.seq) {
      stateRef.current.seq = payload.sequence;
    }
  }, []);

  const handleOrtuTelemetry = useCallback((payload: OrtuTelemetry) => {
    setLatestOrtu(payload);
  }, []);

  const handleCommand = useCallback(
    (topic: string, payload: any) => {
      const cmdType = topic.split("/").pop()?.toUpperCase() || "";

      // Sinkronisasi Mode Waktu & Lokasi dari Dashboard
      if (cmdType === "TIMEMODE" || payload.mode || payload.spot_id) {
        if (payload.triggered_by === "anak") return;

        const notices: string[] = [];

        if (payload.mode) {
          const newMode = payload.mode as TimeMode;
          stateRef.current.timeMode = newMode;
          setSimulatedTimeMode(newMode);
          const modeLabelMap: Record<TimeMode, string> = {
            auto: "Otomatis (Jam Asli)",
            jam_kuliah: "Simulasi Jam Kuliah (09:00 WIB)",
            waktu_sholat: "Simulasi Waktu Sholat (12:15 WIB)",
            jam_malam: "Simulasi Jam Malam (23:00 WIB)",
            lainnya: "Simulasi Jam Normal (16:00 WIB)",
          };
          notices.push(modeLabelMap[newMode] || newMode);
        }

        if (payload.spot_id) {
          const spot = POI_SPOTS.find((s) => s.id === payload.spot_id);
          if (spot) {
            stateRef.current.lockedSpotId = spot.id;
            stateRef.current.lat = spot.lat;
            stateRef.current.lon = spot.lon;
            stateRef.current.accuracy_m = 5.0;
            setLockedSpotId(spot.id);
            setGpsCoords({ lat: spot.lat, lon: spot.lon, accuracy_m: 5.0 });
            notices.push(`Lokasi: ${spot.name}`);
          }
        }

        if (typeof payload.db === "number") {
          const targetDb = Number(payload.db.toFixed(1));
          const targetRms = Number(
            Math.pow(10, (targetDb - 100) / 20).toFixed(6)
          );
          stateRef.current.db = targetDb;
          stateRef.current.rms = targetRms;
          stateRef.current.peakDb = targetDb;
          stateRef.current.presetDbLockUntilMs = Date.now() + 4000;
          setAudioData({ rms: targetRms, db: targetDb });
        }

        if (notices.length > 0) {
          if (timeSyncTimerRef.current) {
            clearTimeout(timeSyncTimerRef.current);
          }
          setTimeSyncNotice(
            `Disinkronkan dari Dashboard: ${notices.join(" | ")}`
          );
          timeSyncTimerRef.current = setTimeout(() => {
            setTimeSyncNotice(null);
            timeSyncTimerRef.current = null;
          }, 4000);
        }

        publishTelemetryNowRef.current();
        return;
      }

      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(
          cmdType === "ALARM" ? [500, 200, 500, 200, 500] : [200, 100, 200]
        );
      }
      playAlertTone(cmdType === "ALARM");
      setIncomingCommand({
        type: cmdType || "PING",
        message: payload.message || "Perintah masuk",
        time: new Date().toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });
    },
    [playAlertTone]
  );

  const mqttHandlers = useMemo(
    () => ({
      onAnakTelemetry: handleAnakTelemetry,
      onOrtuTelemetry: handleOrtuTelemetry,
      onCommand: handleCommand,
    }),
    [handleAnakTelemetry, handleOrtuTelemetry, handleCommand]
  );

  const { isConnected, publishRaw } = useMqtt(mqttHandlers);

  // Catat jumlah kali isConnected berubah dari true ke false sejak sensor dimulai
  useEffect(() => {
    if (
      prevConnectedRef.current &&
      !isConnected &&
      sensorRunningRef.current
    ) {
      diagStatsRef.current.disconnectCount += 1;
    }
    prevConnectedRef.current = isConnected;
  }, [isConnected]);

  const publishTelemetryNow = useCallback(() => {
    if (stateRef.current.lockedSpotId !== "gps_asli") {
      const lockedSpot = POI_SPOTS.find(
        (s) => s.id === stateRef.current.lockedSpotId
      );
      if (lockedSpot) {
        stateRef.current.lat = lockedSpot.lat;
        stateRef.current.lon = lockedSpot.lon;
        stateRef.current.accuracy_m = 5.0;
      }
    }

    const nowMs = Date.now();
    const prevPubMs = lastPublishMsRef.current;

    if (prevPubMs > 0 && diagStatsRef.current.sessionStartMs !== null) {
      const deltaMs = nowMs - prevPubMs;
      const ring = diagStatsRef.current;
      ring.intervalsRing[ring.ringIndex] = deltaMs;
      ring.ringIndex = (ring.ringIndex + 1) % 10;
      if (ring.ringCount < 10) {
        ring.ringCount += 1;
      }
      if (deltaMs > ring.maxGapMs) {
        ring.maxGapMs = deltaMs;
      }
    }

    const nextSeq = Math.max(
      stateRef.current.seq + 1,
      Math.floor(nowMs / 200)
    );
    stateRef.current.seq = nextSeq;
    stateRef.current.localCount += 1;
    setSequence(stateRef.current.localCount);

    const sentAtMs = resolveTelemetryTimestampMs(
      stateRef.current.timeMode,
      nextSeq,
      nowMs
    );

    const consistentRms = computeConsistentRms(stateRef.current.db);

    const speed_mps = resolveEffectiveSpeedMps(
      stateRef.current.lockedSpotId,
      speedTrackerRef.current.getSpeed(nowMs)
    );

    if (nowMs - lastSpeedUiUpdateMsRef.current >= 1000) {
      lastSpeedUiUpdateMsRef.current = nowMs;
      setSpeedMps(speed_mps);
    }

    const payload: AnakTelemetry = {
      device_id: "anak",
      sequence: nextSeq,
      sent_at_ms: sentAtMs,
      location: {
        lat: stateRef.current.lat,
        lon: stateRef.current.lon,
        accuracy_m: stateRef.current.accuracy_m,
        speed_mps,
      },
      audio: {
        rms: consistentRms,
        db: stateRef.current.db,
      },
      motion: {
        accel_magnitude: stateRef.current.accel,
      },
    };

    lastPublishMsRef.current = nowMs;
    lastPublishedDbRef.current = stateRef.current.db;
    lastPublishedZoneRef.current = getAudioZone(stateRef.current.db);
    const publishedOk = publishRaw(MQTT_TOPICS.ANAK_TELEMETRY, payload);
    if (publishedOk) {
      diagStatsRef.current.sentCount += 1;
    } else {
      diagStatsRef.current.skippedCount += 1;
    }

    // Update panel debug maksimal 1x per detik (hanya bila ?debug=1 aktif)
    if (
      isDebugModeRef.current &&
      nowMs - diagStatsRef.current.lastUiUpdateMs >= 1000
    ) {
      diagStatsRef.current.lastUiUpdateMs = nowMs;
      const ring = diagStatsRef.current;
      let avgIntervalMs: number | null = null;
      if (ring.ringCount > 0) {
        let sum = 0;
        for (let i = 0; i < ring.ringCount; i++) {
          sum += ring.intervalsRing[i];
        }
        avgIntervalMs = Math.round(sum / ring.ringCount);
      }

      const sessionElapsedS =
        ring.sessionStartMs !== null
          ? Math.max(0, Math.floor((nowMs - ring.sessionStartMs) / 1000))
          : 0;

      const perfMem =
        typeof performance !== "undefined"
          ? (
              performance as Performance & {
                memory?: PerformanceMemoryLike;
              }
            ).memory
          : undefined;
      const heapUsedMb =
        perfMem && typeof perfMem.usedJSHeapSize === "number"
          ? Number((perfMem.usedJSHeapSize / (1024 * 1024)).toFixed(2))
          : null;

      const gpsFixAgeS =
        stateRef.current.lastGpsFixReceivedMs !== null
          ? Number(
              ((nowMs - stateRef.current.lastGpsFixReceivedMs) / 1000).toFixed(
                1
              )
            )
          : null;

      setDebugSnapshot({
        sentCount: ring.sentCount,
        skippedCount: ring.skippedCount,
        disconnectCount: ring.disconnectCount,
        avgIntervalMs,
        maxGapMs: Math.round(ring.maxGapMs),
        sessionElapsedS,
        heapUsedMb,
        speedMps: speed_mps,
        nativeSpeed: stateRef.current.nativeSpeed,
        lastAccuracyM: stateRef.current.realAcc,
        gpsFixAgeS,
        audioMode: stateRef.current.audioMode,
        audioSettings: stateRef.current.audioSettings,
      });
    }
  }, [publishRaw]);

  useEffect(() => {
    publishTelemetryNowRef.current = publishTelemetryNow;
  }, [publishTelemetryNow]);

  const stopSensors = useCallback(() => {
    sensorRunningRef.current = false;
    sensorStartingRef.current = false;

    if (watchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (audioIntervalRef.current) {
      clearInterval(audioIntervalRef.current);
      audioIntervalRef.current = null;
    }
    if (pubIntervalRef.current) {
      clearInterval(pubIntervalRef.current);
      pubIntervalRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
    stateRef.current.audioSettings = {
      echoCancellation: null,
      noiseSuppression: null,
      autoGainControl: null,
    };
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (motionHandlerRef.current && typeof window !== "undefined") {
      window.removeEventListener("devicemotion", motionHandlerRef.current);
      motionHandlerRef.current = null;
    }
    releaseWakeLock();
    speedTrackerRef.current.reset();
    lastSpeedUiUpdateMsRef.current = 0;
    lastPublishMsRef.current = 0;
    stateRef.current.localCount = 0;
    diagStatsRef.current.sessionStartMs = null;
    diagStatsRef.current.sentCount = 0;
    diagStatsRef.current.skippedCount = 0;
    diagStatsRef.current.disconnectCount = 0;
    diagStatsRef.current.ringIndex = 0;
    diagStatsRef.current.ringCount = 0;
    diagStatsRef.current.maxGapMs = 0;
    diagStatsRef.current.lastUiUpdateMs = 0;
    setSequence(0);
    setSpeedMps(0);
    if (isDebugModeRef.current) {
      setDebugSnapshot((prev) => ({
        ...prev,
        sentCount: 0,
        skippedCount: 0,
        disconnectCount: 0,
        avgIntervalMs: null,
        maxGapMs: 0,
        sessionElapsedS: 0,
        speedMps: 0,
      }));
    }
    setSensorActive(false);
  }, [releaseWakeLock]);

  const handlePosition = useCallback(
    (pos: GeolocationPosition, isInitial: boolean = false) => {
      const nowMs = Date.now();
      const lat = Number(pos.coords.latitude.toFixed(6));
      const lon = Number(pos.coords.longitude.toFixed(6));
      const acc = Number((pos.coords.accuracy || 8).toFixed(1));
      stateRef.current.realLat = lat;
      stateRef.current.realLon = lon;
      stateRef.current.realAcc = acc;
      stateRef.current.nativeSpeed = pos.coords.speed ?? null;
      stateRef.current.lastGpsFixReceivedMs = nowMs;

      speedTrackerRef.current.update(
        {
          lat,
          lon,
          accuracy_m: acc,
          timestamp_ms: pos.timestamp,
        },
        nowMs,
        stateRef.current.nativeSpeed
      );

      if (stateRef.current.lockedSpotId === "gps_asli") {
        stateRef.current.lat = lat;
        stateRef.current.lon = lon;
        stateRef.current.accuracy_m = acc;
        setGpsCoords({ lat, lon, accuracy_m: acc });
        if (isInitial) {
          publishTelemetryNowRef.current();
        }
      }
    },
    []
  );

  const startSensors = async () => {
    // Guard berbasis ref agar tap cepat dua kali tidak membuat interval/stream ganda
    if (sensorRunningRef.current || sensorStartingRef.current) {
      return;
    }
    sensorStartingRef.current = true;
    sensorRunningRef.current = true;
    setSensorActive(true);
    setMicErrorNotice(null);

    const startMs = Date.now();
    lastPublishMsRef.current = 0;
    stateRef.current.localCount = 0;
    diagStatsRef.current.sessionStartMs = startMs;
    diagStatsRef.current.sentCount = 0;
    diagStatsRef.current.skippedCount = 0;
    diagStatsRef.current.disconnectCount = 0;
    diagStatsRef.current.ringIndex = 0;
    diagStatsRef.current.ringCount = 0;
    diagStatsRef.current.maxGapMs = 0;
    diagStatsRef.current.lastUiUpdateMs = 0;

    acquireWakeLock();

    // 1. Geolocation API (Memakai stateRef.current.lockedSpotId agar tidak terkena stale closure)
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => handlePosition(pos, true),
        () => {},
        { enableHighAccuracy: true, timeout: 5000 }
      );

      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => handlePosition(pos, false),
        () => {
          // Gunakan koordinat terakhir jika gagal izin GPS
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
      );
    }

    // 2. Web Audio API (Mikrofon Asli dengan Peak Hold & Instant Trigger)
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("MediaDevices API tidak tersedia");
      }
      const audioConstraints: boolean | MediaTrackConstraints =
        isRawAudioModeRef.current
          ? {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            }
          : true;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      });
      if (!sensorRunningRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        sensorStartingRef.current = false;
        return;
      }
      audioStreamRef.current = stream;
      const audioTrack = stream.getAudioTracks()[0];
      const trackSettings =
        audioTrack && typeof audioTrack.getSettings === "function"
          ? audioTrack.getSettings()
          : null;
      stateRef.current.audioSettings = {
        echoCancellation:
          typeof trackSettings?.echoCancellation === "boolean"
            ? trackSettings.echoCancellation
            : null,
        noiseSuppression:
          typeof trackSettings?.noiseSuppression === "boolean"
            ? trackSettings.noiseSuppression
            : null,
        autoGainControl:
          typeof trackSettings?.autoGainControl === "boolean"
            ? trackSettings.autoGainControl
            : null,
      };
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const dataArr = new Float32Array(analyser.fftSize);
      if (audioIntervalRef.current) {
        clearInterval(audioIntervalRef.current);
      }
      audioIntervalRef.current = setInterval(() => {
        analyser.getFloatTimeDomainData(dataArr);
        let sumSq = 0;
        for (let i = 0; i < dataArr.length; i++) {
          sumSq += dataArr[i] * dataArr[i];
        }
        const rmsVal = Math.sqrt(sumSq / dataArr.length);
        let rawDb = 0;
        if (rmsVal > 0) {
          rawDb = Math.max(0, Math.min(120, 20 * Math.log10(rmsVal) + 100));
        }

        const nowMs = Date.now();

        if (
          nowMs < stateRef.current.presetDbLockUntilMs &&
          rawDb < stateRef.current.db
        ) {
          return;
        }

        if (
          rawDb >= stateRef.current.peakDb ||
          nowMs >= stateRef.current.peakHoldUntilMs
        ) {
          stateRef.current.peakDb = rawDb;
          if (rawDb > 65.0) {
            stateRef.current.peakHoldUntilMs = nowMs + 900;
          }
        }

        const effectiveDb = Number(
          Math.max(rawDb, stateRef.current.peakDb).toFixed(1)
        );
        const effectiveRms = Number(
          Math.pow(10, (effectiveDb - 100) / 20).toFixed(6)
        );

        stateRef.current.rms = effectiveRms;
        stateRef.current.db = effectiveDb;
        setAudioData({ rms: effectiveRms, db: effectiveDb });

        const currentZone = getAudioZone(effectiveDb);
        const zoneChanged = currentZone !== lastPublishedZoneRef.current;
        const dbJump =
          Math.abs(effectiveDb - lastPublishedDbRef.current) >= 6.0;

        if (
          (zoneChanged || dbJump) &&
          nowMs - lastPublishMsRef.current >= 250
        ) {
          publishTelemetryNowRef.current();
        }
      }, 200);
    } catch {
      stateRef.current.audioSettings = {
        echoCancellation: null,
        noiseSuppression: null,
        autoGainControl: null,
      };
      // Tampilkan pesan kecil di UI tanpa menghentikan GPS dan telemetri
      setMicErrorNotice(
        "Akses mikrofon ditolak/tidak tersedia — GPS & telemetri tetap berjalan dengan nilai dB terakhir."
      );
    }

    // 3. DeviceMotion API (Accelerometer)
    if (typeof window !== "undefined" && "DeviceMotionEvent" in window) {
      if (
        typeof (
          DeviceMotionEvent as unknown as {
            requestPermission?: () => Promise<string>;
          }
        ).requestPermission === "function"
      ) {
        try {
          await (
            DeviceMotionEvent as unknown as {
              requestPermission: () => Promise<string>;
            }
          ).requestPermission();
        } catch {
          // Abaikan jika izin iOS ditolak
        }
      }

      if (!sensorRunningRef.current) {
        sensorStartingRef.current = false;
        return;
      }

      const onMotion = (ev: DeviceMotionEvent) => {
        const acc = ev.accelerationIncludingGravity;
        const hasX = typeof acc?.x === "number" && Number.isFinite(acc.x);
        const hasY = typeof acc?.y === "number" && Number.isFinite(acc.y);
        const hasZ = typeof acc?.z === "number" && Number.isFinite(acc.z);
        if (!acc || (!hasX && !hasY && !hasZ)) {
          setAccelAvailable(false);
          return;
        }
        const mag = Math.sqrt(
          (hasX ? acc.x! : 0) ** 2 +
            (hasY ? acc.y! : 0) ** 2 +
            (hasZ ? acc.z! : 0) ** 2
        );
        const roundedMag = Number(mag.toFixed(1));
        stateRef.current.accel = roundedMag;
        setAccelMag(roundedMag);
        setAccelAvailable(true);
      };

      if (motionHandlerRef.current) {
        window.removeEventListener("devicemotion", motionHandlerRef.current);
      }
      motionHandlerRef.current = onMotion;
      window.addEventListener("devicemotion", onMotion);
    } else {
      setAccelAvailable(false);
    }

    if (!sensorRunningRef.current) {
      sensorStartingRef.current = false;
      return;
    }

    publishTelemetryNow();

    // 4. Interval Pengiriman Telemetri MQTT Real-Time (Tiap 1 detik)
    if (pubIntervalRef.current) {
      clearInterval(pubIntervalRef.current);
    }
    pubIntervalRef.current = setInterval(() => {
      publishTelemetryNowRef.current();
    }, 1000);

    sensorStartingRef.current = false;
  };

  useEffect(() => {
    return () => {
      stopSensors();
      if (timeSyncTimerRef.current) {
        clearTimeout(timeSyncTimerRef.current);
        timeSyncTimerRef.current = null;
      }
      if (
        alertAudioCtxRef.current &&
        alertAudioCtxRef.current.state !== "closed"
      ) {
        alertAudioCtxRef.current.close().catch(() => {});
        alertAudioCtxRef.current = null;
      }
    };
  }, [stopSensors]);

  const handleSelectLocationLock = (spotId: string) => {
    stateRef.current.lockedSpotId = spotId;
    setLockedSpotId(spotId);

    if (spotId === "gps_asli") {
      stateRef.current.lat = stateRef.current.realLat;
      stateRef.current.lon = stateRef.current.realLon;
      stateRef.current.accuracy_m = stateRef.current.realAcc;
      setGpsCoords({
        lat: stateRef.current.realLat,
        lon: stateRef.current.realLon,
        accuracy_m: stateRef.current.realAcc,
      });
    } else {
      const spot = POI_SPOTS.find((s) => s.id === spotId);
      if (spot) {
        stateRef.current.lat = spot.lat;
        stateRef.current.lon = spot.lon;
        stateRef.current.accuracy_m = 5.0;
        setGpsCoords({ lat: spot.lat, lon: spot.lon, accuracy_m: 5.0 });
      }
    }

    publishTelemetryNow();
    publishRaw(MQTT_TOPICS.COMMAND_TIMEMODE, {
      spot_id: spotId,
      mode: stateRef.current.timeMode,
      triggered_by: "anak",
      timestamp_ms: Date.now(),
    });
  };

  const handleSelectTimeMode = (mode: TimeMode) => {
    stateRef.current.timeMode = mode;
    setSimulatedTimeMode(mode);
    publishTelemetryNow();
    publishRaw(MQTT_TOPICS.COMMAND_TIMEMODE, {
      mode,
      spot_id: stateRef.current.lockedSpotId,
      triggered_by: "anak",
      timestamp_ms: Date.now(),
    });
  };

  const dbPercent = Math.min(100, Math.max(5, Math.round(audioData.db)));

  const distanceToOrtuM = latestOrtu
    ? Math.round(
        haversineDistanceM(
          gpsCoords.lat,
          gpsCoords.lon,
          latestOrtu.location.lat,
          latestOrtu.location.lon
        )
      )
    : null;

  const remainingSessionS = Math.max(
    0,
    SESSION_TARGET_S - debugSnapshot.sessionElapsedS
  );

  const getRecorderSnapshot = useCallback((): SensorSnapshotInput => {
    const nowMs = Date.now();
    const rawTrackerSpeed = speedTrackerRef.current.getSpeed(nowMs);
    return {
      lat: stateRef.current.lat,
      lon: stateRef.current.lon,
      accuracy_m: stateRef.current.accuracy_m,
      db: stateRef.current.db,
      accel_magnitude: stateRef.current.accel,
      lockedSpotId: stateRef.current.lockedSpotId,
      timeMode: stateRef.current.timeMode,
      seq: stateRef.current.seq,
      nowMs,
      speed_mps: resolveEffectiveSpeedMps(
        stateRef.current.lockedSpotId,
        rawTrackerSpeed
      ),
      speed_native_mps: stateRef.current.nativeSpeed,
      audio_mode: stateRef.current.audioMode,
      audio_settings: stateRef.current.audioSettings,
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#ECEFF4] p-3 sm:p-4 py-5 sm:py-8 flex flex-col justify-start sm:justify-center items-center">
      <div className="w-full max-w-md rounded-[28px] sm:rounded-[32px] bg-white/90 backdrop-blur-2xl border border-white shadow-glass p-4 sm:p-6 space-y-4 sm:space-y-5 my-auto">
        {/* 1. Header Bar */}
        <div className="flex items-center justify-between pb-3.5 border-b border-slate-200/70 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src="/logo.png"
              alt="ISDUGEM?!"
              className="h-6 sm:h-7 w-auto object-contain shrink-0"
            />
            <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[10px] sm:text-[11px] font-bold shrink-0">
              Perangkat Anak
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {wakeLockActive && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                Layar dijaga aktif
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] sm:text-[11px] font-semibold border shrink-0 ${
                isConnected
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-amber-50 text-amber-700 border-amber-200"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                }`}
              />
              {isConnected ? "Terhubung" : "Menunggu"}
            </span>
          </div>
        </div>

        {/* Banner Sinkronisasi dari Dashboard */}
        {timeSyncNotice && (
          <div className="p-3 rounded-2xl bg-sky-50 border border-sky-200 text-sky-900 text-xs font-semibold flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-600 shrink-0" />
            <span className="flex-1 leading-tight">{timeSyncNotice}</span>
          </div>
        )}

        {/* Popup Peringatan Masuk */}
        {incomingCommand && (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 space-y-2">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-rose-700">
                <BellRing className="w-4 h-4" />
                <span>Pesan Masuk ({incomingCommand.type})</span>
              </span>
              <span className="text-[11px] font-mono text-rose-600">
                {incomingCommand.time}
              </span>
            </div>
            <p className="text-xs font-medium">{incomingCommand.message}</p>
            <button
              onClick={() => setIncomingCommand(null)}
              className="w-full py-1.5 rounded-xl bg-rose-600 text-white text-xs font-semibold"
            >
              Tutup
            </button>
          </div>
        )}

        {/* 2. Kartu Sensor Utama Anak (3 Sensor: GPS, Mikrofon, Akselerometer) */}
        <div className="p-4 sm:p-5 rounded-3xl bg-slate-50/90 border border-slate-200/80 space-y-3.5 sm:space-y-4">
          <button
            onClick={sensorActive ? stopSensors : startSensors}
            className={`w-full py-3.5 px-4 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm ${
              sensorActive
                ? "bg-rose-600 hover:bg-rose-700 text-white"
                : "bg-slate-900 hover:bg-slate-800 text-white"
            }`}
          >
            {sensorActive ? (
              <>
                <Square className="w-4 h-4 fill-current" />
                <span>Hentikan Sensor (Paket #{sequence})</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Mulai Sensor & Telemetri</span>
              </>
            )}
          </button>

          {/* Indikator Suara */}
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white border border-slate-200/70 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-slate-600">
                <Mic className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                Suara Sekitar
              </span>
              <span className="font-bold text-slate-900">
                {audioData.db.toFixed(1)} dB
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
              <div
                style={{ width: `${dbPercent}%` }}
                className={`h-full rounded-full transition-all duration-200 ${
                  audioData.db > 75
                    ? "bg-rose-500"
                    : audioData.db >= 55
                    ? "bg-amber-500"
                    : "bg-emerald-500"
                }`}
              />
            </div>
            {micErrorNotice && (
              <p className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200/80 rounded-xl px-2.5 py-1.5 leading-snug">
                {micErrorNotice}
              </p>
            )}
          </div>

          {/* Indikator Lokasi & Gerak */}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            <div className="p-3 sm:p-3.5 rounded-2xl bg-white border border-slate-200/70 min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>Koordinat</span>
              </div>
              <div className="text-[11px] font-bold font-mono text-slate-900 leading-snug">
                <div>{gpsCoords.lat.toFixed(4)},</div>
                <div>{gpsCoords.lon.toFixed(4)}</div>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Akurasi ±{gpsCoords.accuracy_m} m
              </p>
            </div>

            <div className="p-3 sm:p-3.5 rounded-2xl bg-white border border-slate-200/70 min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1">
                <Activity className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>Gerak</span>
              </div>
              <p className="text-xs font-bold text-slate-900">
                {accelAvailable
                  ? `${accelMag.toFixed(1)} m/s²`
                  : "tidak tersedia"}
              </p>
              <p className="text-[10px] font-medium text-slate-600 mt-0.5 truncate">
                Kecepatan {speedMps.toFixed(2)} m/s
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">Accelerometer</p>
            </div>
          </div>
        </div>

        {/* 3. Kartu Lokasi & Status Orang Tua (Real-time dari GPS Edge Ortu) */}
        <div className="p-4 sm:p-5 rounded-3xl bg-slate-50/90 border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900 min-w-0">
              <Radio className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span className="truncate">Lokasi Orang Tua</span>
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${
                latestOrtu
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-white text-slate-500 border-slate-200"
              }`}
            >
              {latestOrtu ? "GPS Aktif" : "Menunggu Ortu"}
            </span>
          </div>

          {latestOrtu ? (
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
              <div className="p-3 rounded-2xl bg-white border border-slate-200/70 min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 mb-1">
                  <MapPin className="w-3 h-3 text-indigo-600 shrink-0" />
                  <span>Koordinat Ortu</span>
                </div>
                <div className="text-[11px] font-bold font-mono text-slate-900 leading-snug">
                  <div>{latestOrtu.location.lat.toFixed(4)},</div>
                  <div>{latestOrtu.location.lon.toFixed(4)}</div>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Akurasi ±{latestOrtu.location.accuracy_m ?? 8} m
                </p>
              </div>

              <div className="p-3 rounded-2xl bg-white border border-slate-200/70 min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 mb-1">
                  <Navigation className="w-3 h-3 text-indigo-600 shrink-0" />
                  <span>Jarak ke Ortu</span>
                </div>
                <p className="text-xs font-bold text-slate-900 truncate">
                  {distanceToOrtuM !== null
                    ? distanceToOrtuM >= 1000
                      ? `${(distanceToOrtuM / 1000).toFixed(2)} km`
                      : `${distanceToOrtuM} m`
                    : "0 m"}
                </p>
                <p className="text-[10px] text-slate-400 mt-1 truncate">
                  {latestOrtu.motion.shake_detected
                    ? "Guncangan!"
                    : `Gerak ${latestOrtu.motion.accel_magnitude.toFixed(1)} m/s²`}
                </p>
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-2xl bg-white border border-slate-200/70 text-xs text-slate-500 text-center leading-relaxed">
              Buka halaman{" "}
              <span className="font-mono font-semibold text-slate-700">
                /ortu
              </span>{" "}
              dan aktifkan sensor untuk melihat posisi GPS orang tua secara
              real-time.
            </div>
          )}
        </div>

        {/* 4. Kartu Kunci Lokasi Demo (Coordinate Lock) */}
        <div className="p-4 sm:p-5 rounded-3xl bg-slate-50/90 border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900 min-w-0">
              <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="truncate">Kunci Koordinat Demo</span>
            </span>
            <span className="text-[11px] font-medium text-slate-400 shrink-0">
              Mikrofon tetap live
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            <button
              onClick={() => handleSelectLocationLock("gps_asli")}
              className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold text-left flex items-center justify-between border transition-all ${
                lockedSpotId === "gps_asli"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200/80 hover:bg-slate-100"
              }`}
            >
              <span className="truncate mr-2">Gunakan GPS Asli HP</span>
              <span className="text-[10px] opacity-75 shrink-0">
                Sensor Hardware
              </span>
            </button>

            {POI_SPOTS.map((spot) => {
              const isSelected = lockedSpotId === spot.id;
              return (
                <button
                  key={spot.id}
                  onClick={() => handleSelectLocationLock(spot.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold text-left flex items-center justify-between border transition-all ${
                    isSelected
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200/80 hover:bg-slate-100"
                  }`}
                >
                  <span className="truncate mr-2">Kunci di {spot.name}</span>
                  <span className="text-[10px] opacity-75 shrink-0">
                    {spot.area}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 5. Kartu Kunci Waktu Demo */}
        <div className="p-4 sm:p-5 rounded-3xl bg-slate-50/90 border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900 min-w-0">
              <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="truncate">Kunci Waktu Demo</span>
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600 font-semibold shrink-0">
              {simulatedTimeMode === "auto" ? "Jam Asli" : simulatedTimeMode}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            {[
              {
                id: "auto",
                label: "Otomatis (Ikuti Jam Asli HP)",
                badge: "Real-time",
              },
              {
                id: "jam_kuliah",
                label: "Simulasi Jam Kuliah",
                badge: "09:00 WIB",
              },
              {
                id: "waktu_sholat",
                label: "Simulasi Waktu Sholat",
                badge: "12:15 WIB",
              },
              {
                id: "jam_malam",
                label: "Simulasi Jam Malam",
                badge: "23:00 WIB",
              },
              {
                id: "lainnya",
                label: "Simulasi Jam Normal",
                badge: "16:00 WIB",
              },
            ].map((opt) => {
              const isSelected = simulatedTimeMode === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleSelectTimeMode(opt.id as TimeMode)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold text-left flex items-center justify-between border transition-all ${
                    isSelected
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200/80 hover:bg-slate-100"
                  }`}
                >
                  <span className="truncate mr-2">{opt.label}</span>
                  <span className="text-[10px] font-mono opacity-80 shrink-0">
                    {opt.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 6. Panel Diagnostik Opsional (?debug=1) */}
        {isDebugMode && (
          <div className="p-4 sm:p-5 rounded-3xl bg-slate-900 text-slate-100 border border-slate-800 space-y-2.5 text-[11px] font-mono">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-emerald-400">
                PANEL DIAGNOSTIK (?debug=1)
              </span>
              <span className="text-[10px] text-slate-400">
                Update maks 1x/dtk
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
              <div>
                <span className="text-slate-400">Terkirim (true):</span>{" "}
                <span className="font-bold text-emerald-300">
                  {debugSnapshot.sentCount}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Dilewati (false):</span>{" "}
                <span className="font-bold text-amber-300">
                  {debugSnapshot.skippedCount}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Putus koneksi:</span>{" "}
                <span className="font-bold text-rose-300">
                  {debugSnapshot.disconnectCount}x
                </span>
              </div>
              <div>
                <span className="text-slate-400">Status MQTT:</span>{" "}
                <span
                  className={`font-bold ${
                    isConnected ? "text-emerald-300" : "text-amber-300"
                  }`}
                >
                  {isConnected ? "Terhubung" : "Terputus"}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Rata2 (10 pub):</span>{" "}
                <span className="font-bold">
                  {debugSnapshot.avgIntervalMs !== null
                    ? `${debugSnapshot.avgIntervalMs} ms`
                    : "-"}
                </span>
              </div>
              <div>
                <span className="text-slate-400">Jeda maks:</span>{" "}
                <span className="font-bold">{debugSnapshot.maxGapMs} ms</span>
              </div>
              <div>
                <span className="text-slate-400">Sisa sesi (30m):</span>{" "}
                <span className="font-bold">
                  {formatDurationMmSs(remainingSessionS)}
                </span>
              </div>
              <div>
                <span className="text-slate-400">speed_mps:</span>{" "}
                <span className="font-bold text-sky-300">
                  {debugSnapshot.speedMps.toFixed(2)} m/s
                </span>
              </div>
              <div>
                <span className="text-slate-400">nativeSpeed:</span>{" "}
                <span className="font-bold">
                  {debugSnapshot.nativeSpeed !== null &&
                  Number.isFinite(debugSnapshot.nativeSpeed)
                    ? `${debugSnapshot.nativeSpeed.toFixed(2)} m/s`
                    : "-"}
                </span>
              </div>
              <div>
                <span className="text-slate-400">accuracy_m GPS:</span>{" "}
                <span className="font-bold">
                  {debugSnapshot.lastAccuracyM.toFixed(1)} m
                </span>
              </div>
              <div>
                <span className="text-slate-400">Umur fix GPS:</span>{" "}
                <span className="font-bold">
                  {debugSnapshot.gpsFixAgeS !== null
                    ? `${debugSnapshot.gpsFixAgeS.toFixed(1)} dtk`
                    : "-"}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400">JS Heap (Chrome):</span>{" "}
                <span className="font-bold">
                  {debugSnapshot.heapUsedMb !== null
                    ? `${debugSnapshot.heapUsedMb.toFixed(2)} MB`
                    : "Tidak tersedia"}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400">audio_mode:</span>{" "}
                <span className="font-bold text-indigo-300">
                  {debugSnapshot.audioMode}
                </span>{" "}
                <span className="text-slate-400">
                  (EC:{" "}
                  {String(debugSnapshot.audioSettings.echoCancellation)} | NS:{" "}
                  {String(debugSnapshot.audioSettings.noiseSuppression)} | AGC:{" "}
                  {String(debugSnapshot.audioSettings.autoGainControl)})
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 7. Mode Perekaman Data Lapangan (?record=1) */}
        {isRecordMode && (
          <FieldRecorder
            liveSource={{
              sensorActive,
              sessionStartMs: diagStatsRef.current.sessionStartMs,
              lastGpsFixReceivedMs: stateRef.current.lastGpsFixReceivedMs,
              getSnapshot: getRecorderSnapshot,
            }}
          />
        )}
      </div>
    </div>
  );
}
