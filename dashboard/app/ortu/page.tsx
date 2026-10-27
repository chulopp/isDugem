"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  MapPin,
  Bell,
  AlertOctagon,
  Smartphone,
  Play,
  Square,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { useMqtt } from "@/hooks/useMqtt";
import {
  MQTT_TOPICS,
  STATUS_DISPLAY,
  evaluateTelemetryLocally,
  getRealtimeTimeLabel,
} from "@/lib/mqttTopics";
import { Alert, AnakTelemetry, OrtuTelemetry } from "@/lib/types";

export default function OrtuEdgePage() {
  const [sensorActive, setSensorActive] = useState(false);
  const [accelMag, setAccelMag] = useState(9.8);
  const [isShaking, setIsShaking] = useState(false);
  const [lastActionNote, setLastActionNote] = useState<string | null>(null);

  const [childAlert, setChildAlert] = useState<Alert>(() =>
    evaluateTelemetryLocally(-7.0502, 110.4398, 52.4, "jam_kuliah")
  );

  const seqRef = useRef(0);
  const lastShakeMsRef = useRef(0);
  const accelRef = useRef(9.8);
  const shakeFlagRef = useRef(false);
  const pubIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const motionHandlerRef = useRef<((ev: DeviceMotionEvent) => void) | null>(null);

  const { isConnected, publishRaw, publishCommand } = useMqtt({
    onAlert: (payload) => {
      setChildAlert(payload);
    },
    onAnakTelemetry: (payload: AnakTelemetry) => {
      const evaluated = evaluateTelemetryLocally(
        payload.location.lat,
        payload.location.lon,
        payload.audio.db,
        getRealtimeTimeLabel(new Date())
      );
      setChildAlert(evaluated);
    },
  });

  const triggerManualCommand = useCallback(
    (type: "ping" | "reminder" | "alarm", customText?: string) => {
      publishCommand(type, customText, "ortu");
      const labelMap = {
        ping: "Ping Lokasi terkirim ke perangkat anak.",
        reminder: "Pengingat terkirim ke perangkat anak.",
        alarm: "Alarm darurat terkirim ke perangkat anak.",
      };
      setLastActionNote(labelMap[type]);
      setTimeout(() => setLastActionNote(null), 2500);
    },
    [publishCommand]
  );

  const stopOrtuSensor = useCallback(() => {
    if (pubIntervalRef.current) {
      clearInterval(pubIntervalRef.current);
      pubIntervalRef.current = null;
    }
    if (motionHandlerRef.current && typeof window !== "undefined") {
      window.removeEventListener("devicemotion", motionHandlerRef.current);
      motionHandlerRef.current = null;
    }
    setSensorActive(false);
  }, []);

  const startOrtuSensor = async () => {
    setSensorActive(true);

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
        if (!acc) return;
        const mag = Math.sqrt(
          (acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2
        );
        const rounded = Number(mag.toFixed(1));
        accelRef.current = rounded;
        setAccelMag(rounded);

        const now = Date.now();
        if (rounded > 18.0 && now - lastShakeMsRef.current > 2000) {
          lastShakeMsRef.current = now;
          shakeFlagRef.current = true;
          setIsShaking(true);
          triggerManualCommand(
            "ping",
            "Guncangan HP orang tua terdeteksi. Mengecek posisi anak."
          );

          setTimeout(() => {
            shakeFlagRef.current = false;
            setIsShaking(false);
          }, 1500);
        }
      };

      if (motionHandlerRef.current) {
        window.removeEventListener("devicemotion", motionHandlerRef.current);
      }
      motionHandlerRef.current = onMotion;
      window.addEventListener("devicemotion", onMotion);
    }

    pubIntervalRef.current = setInterval(() => {
      seqRef.current += 1;
      const payload: OrtuTelemetry = {
        device_id: "ortu",
        sequence: seqRef.current,
        sent_at_ms: Date.now(),
        location: {
          lat: -7.054,
          lon: 110.438,
        },
        motion: {
          accel_magnitude: accelRef.current,
          shake_detected: shakeFlagRef.current,
        },
      };
      publishRaw(MQTT_TOPICS.ORTU_TELEMETRY, payload);
    }, 3000);
  };

  useEffect(() => {
    return () => stopOrtuSensor();
  }, [stopOrtuSensor]);

  const statusInfo =
    STATUS_DISPLAY[childAlert.status] || STATUS_DISPLAY.NORMAL;

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
              Perangkat Ortu
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

        {/* 2. Kartu Status Anak Terkini */}
        <div
          className={`p-5 rounded-3xl border ${statusInfo.badgeBg} ${statusInfo.borderColor} space-y-2`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase">
              Status Anak
            </span>
            <span
              className={`inline-flex items-center gap-1.5 text-xs font-bold ${statusInfo.badgeText}`}
            >
              {statusInfo.severity === "critical" ? (
                <ShieldAlert className="w-4 h-4" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>{statusInfo.label}</span>
            </span>
          </div>
          <p className="text-xs font-medium text-slate-800">
            {childAlert.reason}
          </p>
        </div>

        {/* 3. Kartu Sensor Gerak Shake-to-Ping */}
        <div className="p-5 rounded-3xl bg-slate-50/90 border border-slate-200/80 space-y-4">
          <button
            onClick={sensorActive ? stopOrtuSensor : startOrtuSensor}
            className={`w-full py-3.5 px-4 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm ${
              sensorActive
                ? "bg-rose-600 hover:bg-rose-700 text-white"
                : "bg-slate-900 hover:bg-slate-800 text-white"
            }`}
          >
            {sensorActive ? (
              <>
                <Square className="w-4 h-4 fill-current" />
                <span>Hentikan Sensor Gerak</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Aktifkan Sensor Shake-to-Ping</span>
              </>
            )}
          </button>

          <div
            className={`p-4 rounded-2xl border text-center transition-all ${
              isShaking
                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                : "bg-white border-slate-200/80 text-slate-700"
            }`}
          >
            <Smartphone className="w-6 h-6 mx-auto mb-1.5 text-slate-700" />
            <p className="text-xs font-bold">
              {isShaking
                ? "Guncangan Terdeteksi. Mengirim Ping..."
                : "Goyangkan HP untuk Kirim Ping"}
            </p>
            <p className="text-[11px] font-mono text-slate-400 mt-1">
              Akselerasi: {accelMag.toFixed(1)} m/s² (Batas: 18.0 m/s²)
            </p>
          </div>
        </div>

        {/* 4. Kartu Tombol Perintah Manual */}
        <div className="p-5 rounded-3xl bg-slate-50/90 border border-slate-200/80 space-y-3">
          <p className="text-xs font-bold text-slate-900">Perintah Manual</p>

          <div className="grid grid-cols-3 gap-2.5">
            <button
              onClick={() => triggerManualCommand("ping")}
              className="p-3 rounded-2xl bg-white hover:bg-slate-900 text-slate-800 hover:text-white border border-slate-200/80 flex flex-col items-center gap-1.5 text-xs font-semibold transition-all active:scale-95"
            >
              <MapPin className="w-4 h-4" />
              <span>Ping</span>
            </button>

            <button
              onClick={() => triggerManualCommand("reminder")}
              className="p-3 rounded-2xl bg-white hover:bg-amber-600 text-slate-800 hover:text-white border border-slate-200/80 flex flex-col items-center gap-1.5 text-xs font-semibold transition-all active:scale-95"
            >
              <Bell className="w-4 h-4" />
              <span>Ingatkan</span>
            </button>

            <button
              onClick={() => triggerManualCommand("alarm")}
              className="p-3 rounded-2xl bg-white hover:bg-rose-600 text-rose-600 hover:text-white border border-slate-200/80 flex flex-col items-center gap-1.5 text-xs font-semibold transition-all active:scale-95"
            >
              <AlertOctagon className="w-4 h-4" />
              <span>Alarm</span>
            </button>
          </div>

          {lastActionNote && (
            <p className="text-center text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl py-2 px-3">
              {lastActionNote}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
