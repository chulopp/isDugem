"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
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
import { getSimulatedTimestampMs } from "@/lib/mockData";

function playAlertTone(isAlarm: boolean) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = isAlarm ? "sawtooth" : "sine";
    osc.frequency.setValueAtTime(isAlarm ? 880 : 587.33, ctx.currentTime);
    if (isAlarm) {
      osc.frequency.setValueAtTime(660, ctx.currentTime + 0.25);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.5);
    }

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + (isAlarm ? 0.9 : 0.45)
    );

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (isAlarm ? 0.9 : 0.45));
  } catch {
    // Ignore audio play restriction
  }
}

function getAudioZone(db: number): number {
  if (db < 55.0) return 0;
  if (db < 65.0) return 1;
  if (db <= 75.0) return 2;
  if (db <= 80.0) return 3;
  return 4;
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

  const stateRef = useRef({
    lat: -7.0502,
    lon: 110.4398,
    accuracy_m: 8.0,
    realLat: -7.0502,
    realLon: 110.4398,
    realAcc: 8.0,
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
  });

  const lastPublishMsRef = useRef<number>(0);
  const lastPublishedDbRef = useRef<number>(48.0);
  const lastPublishedZoneRef = useRef<number>(getAudioZone(48.0));
  const publishTelemetryNowRef = useRef<() => void>(() => {});

  const watchIdRef = useRef<number | null>(null);
  const audioIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pubIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const motionHandlerRef = useRef<((ev: DeviceMotionEvent) => void) | null>(null);

  const { isConnected, publishRaw } = useMqtt({
    onAnakTelemetry: (payload) => {
      if (payload.sequence && payload.sequence > stateRef.current.seq) {
        stateRef.current.seq = payload.sequence;
      }
    },
    onOrtuTelemetry: (payload) => {
      setLatestOrtu(payload);
    },
    onCommand: (topic, payload: any) => {
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
          const targetRms = Number(Math.pow(10, (targetDb - 100) / 20).toFixed(6));
          stateRef.current.db = targetDb;
          stateRef.current.rms = targetRms;
          stateRef.current.peakDb = targetDb;
          stateRef.current.presetDbLockUntilMs = Date.now() + 4000;
          setAudioData({ rms: targetRms, db: targetDb });
        }

        if (notices.length > 0) {
          setTimeSyncNotice(`Disinkronkan dari Dashboard: ${notices.join(" | ")}`);
          setTimeout(() => setTimeSyncNotice(null), 4000);
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
  });

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

    const nextSeq = Math.max(
      stateRef.current.seq + 1,
      Math.floor(Date.now() / 200)
    );
    stateRef.current.seq = nextSeq;
    stateRef.current.localCount += 1;
    setSequence(stateRef.current.localCount);

    let sentAtMs = Date.now();
    if (stateRef.current.timeMode !== "auto") {
      sentAtMs = getSimulatedTimestampMs(stateRef.current.timeMode, nextSeq);
    }

    const consistentRms = Number(
      Math.pow(10, (stateRef.current.db - 100) / 20).toFixed(6)
    );

    const payload: AnakTelemetry = {
      device_id: "anak",
      sequence: nextSeq,
      sent_at_ms: sentAtMs,
      location: {
        lat: stateRef.current.lat,
        lon: stateRef.current.lon,
        accuracy_m: stateRef.current.accuracy_m,
      },
      audio: {
        rms: consistentRms,
        db: stateRef.current.db,
      },
      motion: {
        accel_magnitude: stateRef.current.accel,
      },
    };

    lastPublishMsRef.current = Date.now();
    lastPublishedDbRef.current = stateRef.current.db;
    lastPublishedZoneRef.current = getAudioZone(stateRef.current.db);
    publishRaw(MQTT_TOPICS.ANAK_TELEMETRY, payload);
  }, [publishRaw]);

  useEffect(() => {
    publishTelemetryNowRef.current = publishTelemetryNow;
  }, [publishTelemetryNow]);

  const stopSensors = useCallback(() => {
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
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (motionHandlerRef.current && typeof window !== "undefined") {
      window.removeEventListener("devicemotion", motionHandlerRef.current);
      motionHandlerRef.current = null;
    }
    setSensorActive(false);
  }, []);

  const startSensors = async () => {
    setSensorActive(true);

    // 1. Geolocation API (Memakai stateRef.current.lockedSpotId agar tidak terkena stale closure)
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lon = Number(pos.coords.longitude.toFixed(6));
          const acc = Number((pos.coords.accuracy || 8).toFixed(1));
          stateRef.current.realLat = lat;
          stateRef.current.realLon = lon;
          stateRef.current.realAcc = acc;

          if (stateRef.current.lockedSpotId === "gps_asli") {
            stateRef.current.lat = lat;
            stateRef.current.lon = lon;
            stateRef.current.accuracy_m = acc;
            setGpsCoords({ lat, lon, accuracy_m: acc });
            publishTelemetryNowRef.current();
          }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 5000 }
      );

      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lon = Number(pos.coords.longitude.toFixed(6));
          const acc = Number((pos.coords.accuracy || 8).toFixed(1));
          stateRef.current.realLat = lat;
          stateRef.current.realLon = lon;
          stateRef.current.realAcc = acc;

          if (stateRef.current.lockedSpotId === "gps_asli") {
            stateRef.current.lat = lat;
            stateRef.current.lon = lon;
            stateRef.current.accuracy_m = acc;
            setGpsCoords({ lat, lon, accuracy_m: acc });
          }
        },
        () => {
          // Gunakan koordinat terakhir jika gagal izin GPS
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
      );
    }

    // 2. Web Audio API (Mikrofon Asli dengan Peak Hold & Instant Trigger)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
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
        const dbJump = Math.abs(effectiveDb - lastPublishedDbRef.current) >= 6.0;

        if ((zoneChanged || dbJump) && nowMs - lastPublishMsRef.current >= 250) {
          publishTelemetryNowRef.current();
        }
      }, 200);
    } catch {
      // Fallback jika mikrofon ditolak
    }

    // 3. DeviceMotion API (Accelerometer)
    if (typeof window !== "undefined" && "DeviceMotionEvent" in window) {
      if (
        typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> })
          .requestPermission === "function"
      ) {
        try {
          await (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> })
            .requestPermission();
        } catch {
          // Abaikan jika izin iOS ditolak
        }
      }

      const onMotion = (ev: DeviceMotionEvent) => {
        const acc = ev.accelerationIncludingGravity;
        if (acc) {
          const mag = Math.sqrt(
            (acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2
          );
          const roundedMag = Number(mag.toFixed(1));
          stateRef.current.accel = roundedMag;
          setAccelMag(roundedMag);
        }
      };

      if (motionHandlerRef.current) {
        window.removeEventListener("devicemotion", motionHandlerRef.current);
      }
      motionHandlerRef.current = onMotion;
      window.addEventListener("devicemotion", onMotion);
    }

    publishTelemetryNow();

    // 4. Interval Pengiriman Telemetri MQTT Real-Time (Tiap 1 detik)
    pubIntervalRef.current = setInterval(() => {
      publishTelemetryNowRef.current();
    }, 1000);
  };

  useEffect(() => {
    return () => stopSensors();
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
                {accelMag.toFixed(1)} m/s²
              </p>
              <p className="text-[10px] text-slate-400 mt-1">Accelerometer</p>
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
              Buka halaman <span className="font-mono font-semibold text-slate-700">/ortu</span> dan aktifkan sensor untuk melihat posisi GPS orang tua secara real-time.
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
              <span className="text-[10px] opacity-75 shrink-0">Sensor Hardware</span>
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
                  <span className="text-[10px] opacity-75 shrink-0">{spot.area}</span>
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
              { id: "auto", label: "Otomatis (Ikuti Jam Asli HP)", badge: "Real-time" },
              { id: "jam_kuliah", label: "Simulasi Jam Kuliah", badge: "09:00 WIB" },
              { id: "waktu_sholat", label: "Simulasi Waktu Sholat", badge: "12:15 WIB" },
              { id: "jam_malam", label: "Simulasi Jam Malam", badge: "23:00 WIB" },
              { id: "lainnya", label: "Simulasi Jam Normal", badge: "16:00 WIB" },
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
                  <span className="text-[10px] font-mono opacity-80 shrink-0">{opt.badge}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
