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
} from "lucide-react";
import { useMqtt } from "@/hooks/useMqtt";
import { MQTT_TOPICS, POI_SPOTS } from "@/lib/mqttTopics";
import { AnakTelemetry, CommandPayload } from "@/lib/types";

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

export default function AnakEdgePage() {
  const [sensorActive, setSensorActive] = useState(false);
  const [sequence, setSequence] = useState(0);

  // State Sensor
  const [gpsCoords, setGpsCoords] = useState({
    lat: -7.0502,
    lon: 110.4398,
    accuracy_m: 8.0,
  });
  const [audioData, setAudioData] = useState({ rms: 0.012, db: 48.0 });
  const [accelMag, setAccelMag] = useState(9.8);

  // Mode Kunci Koordinat Demo ("gps_asli" atau id dari POI_SPOTS)
  const [lockedSpotId, setLockedSpotId] = useState<string>("gps_asli");

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
    rms: 0.012,
    db: 48.0,
    accel: 9.8,
    seq: 0,
  });

  const watchIdRef = useRef<number | null>(null);
  const audioIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pubIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const motionHandlerRef = useRef<((ev: DeviceMotionEvent) => void) | null>(null);

  const { isConnected, publishRaw } = useMqtt({
    onCommand: (topic, payload: CommandPayload) => {
      const cmdType = topic.split("/").pop()?.toUpperCase() || "PING";
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(
          cmdType === "ALARM" ? [500, 200, 500, 200, 500] : [200, 100, 200]
        );
      }
      playAlertTone(cmdType === "ALARM");
      setIncomingCommand({
        type: cmdType,
        message: payload.message,
        time: new Date().toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      });
    },
  });

  // Update koordinat saat mode kunci lokasi dipilih
  useEffect(() => {
    if (lockedSpotId !== "gps_asli") {
      const spot = POI_SPOTS.find((s) => s.id === lockedSpotId);
      if (spot) {
        setGpsCoords({ lat: spot.lat, lon: spot.lon, accuracy_m: 5.0 });
        stateRef.current.lat = spot.lat;
        stateRef.current.lon = spot.lon;
        stateRef.current.accuracy_m = 5.0;
      }
    }
  }, [lockedSpotId]);

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

    // 1. Geolocation API
    if ("geolocation" in navigator) {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          if (lockedSpotId === "gps_asli") {
            const lat = Number(pos.coords.latitude.toFixed(6));
            const lon = Number(pos.coords.longitude.toFixed(6));
            const acc = Number((pos.coords.accuracy || 8).toFixed(1));
            stateRef.current.lat = lat;
            stateRef.current.lon = lon;
            stateRef.current.accuracy_m = acc;
            setGpsCoords({ lat, lon, accuracy_m: acc });
          }
        },
        () => {
          // Gunakan koordinat terakhir jika gagal izin GPS
        },
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 5000 }
      );
    }

    // 2. Web Audio API (Mikrofon Asli)
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
        let dbVal = 0;
        if (rmsVal > 0) {
          dbVal = Math.max(0, Math.min(120, 20 * Math.log10(rmsVal) + 100));
        }
        const roundedRms = Number(rmsVal.toFixed(4));
        const roundedDb = Number(dbVal.toFixed(1));
        stateRef.current.rms = roundedRms;
        stateRef.current.db = roundedDb;
        setAudioData({ rms: roundedRms, db: roundedDb });
      }, 250);
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

    // 4. Interval Pengiriman Telemetri MQTT (Tiap 2.5 detik)
    pubIntervalRef.current = setInterval(() => {
      stateRef.current.seq += 1;
      setSequence(stateRef.current.seq);

      const payload: AnakTelemetry = {
        device_id: "anak",
        sequence: stateRef.current.seq,
        sent_at_ms: Date.now(),
        location: {
          lat: stateRef.current.lat,
          lon: stateRef.current.lon,
          accuracy_m: stateRef.current.accuracy_m,
        },
        audio: {
          rms: stateRef.current.rms,
          db: stateRef.current.db,
        },
        motion: {
          accel_magnitude: stateRef.current.accel,
        },
      };

      publishRaw(MQTT_TOPICS.ANAK_TELEMETRY, payload);
    }, 2500);
  };

  useEffect(() => {
    return () => stopSensors();
  }, [stopSensors]);

  const dbPercent = Math.min(100, Math.max(5, Math.round(audioData.db)));

  return (
    <div className="min-h-screen bg-[#ECEFF4] p-4 flex items-center justify-center">
      <div className="w-full max-w-md rounded-[32px] bg-white/90 backdrop-blur-2xl border border-white shadow-glass p-6 space-y-5">
        {/* 1. Header Bar */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-200/70">
          <div className="flex items-center gap-2.5">
            <img
              src="/logo.png"
              alt="ISDUGEM?!"
              className="h-7 w-auto object-contain"
            />
            <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-bold">
              Perangkat Anak
            </span>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
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

        {/* 2. Kartu Sensor Utama */}
        <div className="p-5 rounded-3xl bg-slate-50/90 border border-slate-200/80 space-y-4">
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
          <div className="p-3.5 rounded-2xl bg-white border border-slate-200/70 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-slate-600">
                <Mic className="w-3.5 h-3.5 text-slate-400" />
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
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-white border border-slate-200/70">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <span>Koordinat</span>
              </div>
              <p className="text-xs font-bold font-mono text-slate-900 truncate">
                {gpsCoords.lat.toFixed(4)}, {gpsCoords.lon.toFixed(4)}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Akurasi ±{gpsCoords.accuracy_m} m
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-white border border-slate-200/70">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1">
                <Activity className="w-3.5 h-3.5 text-slate-400" />
                <span>Gerak</span>
              </div>
              <p className="text-xs font-bold text-slate-900">
                {accelMag.toFixed(1)} m/s²
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">Accelerometer</p>
            </div>
          </div>
        </div>

        {/* 3. Kartu Kunci Lokasi Demo (Coordinate Lock) */}
        <div className="p-5 rounded-3xl bg-slate-50/90 border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              <span>Kunci Koordinat Demo</span>
            </span>
            <span className="text-[11px] font-medium text-slate-400">
              Mikrofon tetap live
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            <button
              onClick={() => setLockedSpotId("gps_asli")}
              className={`px-3.5 py-2.5 rounded-xl text-xs font-semibold text-left flex items-center justify-between border transition-all ${
                lockedSpotId === "gps_asli"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200/80 hover:bg-slate-100"
              }`}
            >
              <span>Gunakan GPS Asli HP</span>
              <span className="text-[10px] opacity-75">Sensor Hardware</span>
            </button>

            {POI_SPOTS.map((spot) => {
              const isSelected = lockedSpotId === spot.id;
              return (
                <button
                  key={spot.id}
                  onClick={() => setLockedSpotId(spot.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold text-left flex items-center justify-between border transition-all ${
                    isSelected
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200/80 hover:bg-slate-100"
                  }`}
                >
                  <span>Kunci di {spot.name}</span>
                  <span className="text-[10px] opacity-75">{spot.area}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
