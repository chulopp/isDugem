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
  Activity,
  Navigation,
  Lock,
} from "lucide-react";
import { useMqtt } from "@/hooks/useMqtt";
import {
  MQTT_TOPICS,
  STATUS_DISPLAY,
  haversineDistanceM,
} from "@/lib/mqttTopics";
import { Alert, AnakTelemetry, OrtuTelemetry } from "@/lib/types";

const ORTU_PRESET_SPOTS = [
  {
    id: "rumah_tembalang",
    name: "Rumah Orang Tua (Tembalang)",
    area: "Semarang Atas",
    lat: -7.054,
    lon: 110.438,
  },
  {
    id: "kantor_simpanglima",
    name: "Kantor Orang Tua (Simpang Lima)",
    area: "Semarang Tengah",
    lat: -6.9904,
    lon: 110.4229,
  },
];

export default function OrtuEdgePage() {
  const [sensorActive, setSensorActive] = useState(false);
  const [sequence, setSequence] = useState(0);
  const [gpsCoords, setGpsCoords] = useState({
    lat: -7.054,
    lon: 110.438,
    accuracy_m: 8.0,
  });
  const [lockedLocId, setLockedLocId] = useState<string>("gps_asli");
  const [accelMag, setAccelMag] = useState(9.8);
  const [isShaking, setIsShaking] = useState(false);
  const [lastActionNote, setLastActionNote] = useState<string | null>(null);

  const [childAlert, setChildAlert] = useState<Alert | null>(null);
  const [latestAnakTelemetry, setLatestAnakTelemetry] =
    useState<AnakTelemetry | null>(null);

  const stateRef = useRef({
    lat: -7.054,
    lon: 110.438,
    accuracy_m: 8.0,
    realLat: -7.054,
    realLon: 110.438,
    realAcc: 8.0,
    lockedLocId: "gps_asli",
    accel: 9.8,
    shake: false,
    seq: Math.floor(Date.now() / 200),
    localCount: 0,
  });

  const lastShakeMsRef = useRef(0);
  const watchIdRef = useRef<number | null>(null);
  const pubIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const motionHandlerRef = useRef<((ev: DeviceMotionEvent) => void) | null>(null);
  const publishOrtuNowRef = useRef<() => void>(() => {});

  const { isConnected, publishRaw, publishCommand } = useMqtt({
    onAlert: (payload) => {
      setChildAlert(payload);
    },
    onAnakTelemetry: (payload: AnakTelemetry) => {
      setLatestAnakTelemetry(payload);
    },
    onOrtuTelemetry: (payload: OrtuTelemetry) => {
      if (payload.sequence && payload.sequence > stateRef.current.seq) {
        stateRef.current.seq = payload.sequence;
      }
    },
  });

  const publishOrtuNow = useCallback(() => {
    if (stateRef.current.lockedLocId !== "gps_asli") {
      const preset = ORTU_PRESET_SPOTS.find(
        (s) => s.id === stateRef.current.lockedLocId
      );
      if (preset) {
        stateRef.current.lat = preset.lat;
        stateRef.current.lon = preset.lon;
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

    const payload: OrtuTelemetry = {
      device_id: "ortu",
      sequence: nextSeq,
      sent_at_ms: Date.now(),
      location: {
        lat: stateRef.current.lat,
        lon: stateRef.current.lon,
        accuracy_m: stateRef.current.accuracy_m,
      },
      motion: {
        accel_magnitude: stateRef.current.accel,
        shake_detected: stateRef.current.shake,
      },
    };
    publishRaw(MQTT_TOPICS.ORTU_TELEMETRY, payload);
  }, [publishRaw]);

  useEffect(() => {
    publishOrtuNowRef.current = publishOrtuNow;
  }, [publishOrtuNow]);

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
    if (watchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
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

    // 1. Sensor Fisik 1: Geolocation API (GPS HP Orang Tua)
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lon = Number(pos.coords.longitude.toFixed(6));
          const acc = Number((pos.coords.accuracy || 8).toFixed(1));
          stateRef.current.realLat = lat;
          stateRef.current.realLon = lon;
          stateRef.current.realAcc = acc;
          if (stateRef.current.lockedLocId === "gps_asli") {
            stateRef.current.lat = lat;
            stateRef.current.lon = lon;
            stateRef.current.accuracy_m = acc;
            setGpsCoords({ lat, lon, accuracy_m: acc });
            publishOrtuNowRef.current();
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

          if (stateRef.current.lockedLocId === "gps_asli") {
            stateRef.current.lat = lat;
            stateRef.current.lon = lon;
            stateRef.current.accuracy_m = acc;
            setGpsCoords({ lat, lon, accuracy_m: acc });
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
      );
    }

    // 2. Sensor Fisik 2: DeviceMotion API (Accelerometer Shake-to-Ping)
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
        stateRef.current.accel = rounded;
        setAccelMag(rounded);

        const now = Date.now();
        if (rounded > 18.0 && now - lastShakeMsRef.current > 2000) {
          lastShakeMsRef.current = now;
          stateRef.current.shake = true;
          setIsShaking(true);
          publishOrtuNowRef.current();
          triggerManualCommand(
            "ping",
            "Guncangan HP orang tua terdeteksi. Mengecek posisi anak."
          );

          setTimeout(() => {
            stateRef.current.shake = false;
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

    publishOrtuNow();

    pubIntervalRef.current = setInterval(() => {
      publishOrtuNowRef.current();
    }, 1500);
  };

  useEffect(() => {
    return () => stopOrtuSensor();
  }, [stopOrtuSensor]);

  const handleSelectOrtuLoc = (locId: string) => {
    stateRef.current.lockedLocId = locId;
    setLockedLocId(locId);

    if (locId === "gps_asli") {
      stateRef.current.lat = stateRef.current.realLat;
      stateRef.current.lon = stateRef.current.realLon;
      stateRef.current.accuracy_m = stateRef.current.realAcc;
      setGpsCoords({
        lat: stateRef.current.realLat,
        lon: stateRef.current.realLon,
        accuracy_m: stateRef.current.realAcc,
      });
    } else {
      const preset = ORTU_PRESET_SPOTS.find((s) => s.id === locId);
      if (preset) {
        stateRef.current.lat = preset.lat;
        stateRef.current.lon = preset.lon;
        stateRef.current.accuracy_m = 5.0;
        setGpsCoords({ lat: preset.lat, lon: preset.lon, accuracy_m: 5.0 });
      }
    }

    publishOrtuNow();
  };

  const isBackendActive = isConnected && childAlert !== null;
  const statusInfo = childAlert
    ? STATUS_DISPLAY[childAlert.status] || STATUS_DISPLAY.NORMAL
    : null;

  const distanceToAnakM = latestAnakTelemetry
    ? Math.round(
        haversineDistanceM(
          gpsCoords.lat,
          gpsCoords.lon,
          latestAnakTelemetry.location.lat,
          latestAnakTelemetry.location.lon
        )
      )
    : null;

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
              !isConnected
                ? "bg-amber-50 text-amber-700 border-amber-200"
                : isBackendActive
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-sky-50 text-sky-700 border-sky-200"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                !isConnected
                  ? "bg-amber-500"
                  : isBackendActive
                  ? "bg-emerald-500 animate-pulse"
                  : "bg-sky-500"
              }`}
            />
            {!isConnected
              ? "Menghubungkan"
              : isBackendActive
              ? "Backend Aktif"
              : "Broker Terhubung"}
          </span>
        </div>

        {/* 2. Kartu Status & Lokasi Anak Terkini */}
        <div
          className={`p-5 rounded-3xl border space-y-2.5 ${
            statusInfo
              ? `${statusInfo.badgeBg} ${statusInfo.borderColor}`
              : "bg-slate-50/90 border-slate-200/80"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase">
              Status Anak
            </span>
            {statusInfo ? (
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
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                <span>MENUNGGU BACKEND</span>
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-slate-800">
            {childAlert
              ? childAlert.reason
              : latestAnakTelemetry
              ? `Telemetri anak diterima (${latestAnakTelemetry.audio.db.toFixed(1)} dB). Menunggu evaluasi dari server backend.`
              : "Menunggu alert resmi dari backend..."}
          </p>

          {latestAnakTelemetry && (
            <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px] font-mono text-slate-600">
              <span>
                GPS Anak: {latestAnakTelemetry.location.lat.toFixed(4)},{" "}
                {latestAnakTelemetry.location.lon.toFixed(4)}
              </span>
              {distanceToAnakM !== null && (
                <span className="inline-flex items-center gap-1 font-sans font-bold text-slate-800 bg-white/80 px-2 py-0.5 rounded-md border border-slate-200/80">
                  <Navigation className="w-3 h-3 text-indigo-600" />
                  {distanceToAnakM >= 1000
                    ? `${(distanceToAnakM / 1000).toFixed(2)} km`
                    : `${distanceToAnakM} m`}
                </span>
              )}
            </div>
          )}
        </div>

        {/* 3. Kartu 2 Sensor Fisik Ortu (GPS + Accelerometer Shake-to-Ping) */}
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
                <span>Hentikan Sensor Ortu (Paket #{sequence})</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" />
                <span>Mulai Sensor GPS & Shake-to-Ping</span>
              </>
            )}
          </button>

          {/* Indikator 2 Sensor Hardware Ortu: GPS & Akselerometer */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-white border border-slate-200/70">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                <span>GPS Ortu</span>
              </div>
              <p className="text-[11px] font-bold font-mono text-slate-900 whitespace-nowrap">
                {gpsCoords.lat.toFixed(4)}, {gpsCoords.lon.toFixed(4)}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Akurasi ±{gpsCoords.accuracy_m} m
              </p>
            </div>

            <div className="p-3.5 rounded-2xl bg-white border border-slate-200/70">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 mb-1">
                <Activity className="w-3.5 h-3.5 text-slate-400" />
                <span>Gerak Ortu</span>
              </div>
              <p className="text-xs font-bold text-slate-900">
                {accelMag.toFixed(1)} m/s²
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Batas Shake: 18.0 m/s²
              </p>
            </div>
          </div>

          <div
            className={`p-3.5 rounded-2xl border text-center transition-all ${
              isShaking
                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                : "bg-white border-slate-200/80 text-slate-700"
            }`}
          >
            <Smartphone className="w-5 h-5 mx-auto mb-1 text-slate-700" />
            <p className="text-xs font-bold">
              {isShaking
                ? "Guncangan Terdeteksi. Mengirim Ping ke Anak..."
                : "Goyangkan HP Orang Tua untuk Kirim Ping"}
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

        {/* 5. Kartu Mode Sumber Lokasi GPS Ortu */}
        <div className="p-5 rounded-3xl bg-slate-50/90 border border-slate-200/80 space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              <span>Sumber Lokasi GPS Ortu</span>
            </span>
            <span className="text-[10px] font-medium text-slate-400">
              Dikirim ke HP Anak
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            <button
              onClick={() => handleSelectOrtuLoc("gps_asli")}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold text-left flex items-center justify-between border transition-all ${
                lockedLocId === "gps_asli"
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-700 border-slate-200/80 hover:bg-slate-100"
              }`}
            >
              <span>Gunakan GPS Asli HP Ortu</span>
              <span className="text-[10px] opacity-75">Sensor Hardware</span>
            </button>

            {ORTU_PRESET_SPOTS.map((spot) => {
              const isSelected = lockedLocId === spot.id;
              return (
                <button
                  key={spot.id}
                  onClick={() => handleSelectOrtuLoc(spot.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-semibold text-left flex items-center justify-between border transition-all ${
                    isSelected
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200/80 hover:bg-slate-100"
                  }`}
                >
                  <span>Simulasi di {spot.name}</span>
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
