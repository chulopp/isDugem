"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Calendar, Clock, ChevronDown, Check, Menu } from "lucide-react";
import Sidebar, { NavTab } from "@/components/Sidebar";
import KpiStrip from "@/components/KpiStrip";
import MapPanel from "@/components/MapPanel";
import HistoryChart from "@/components/HistoryChart";
import DemoPresetPanel from "@/components/DemoPresetPanel";
import SystemControlPanel from "@/components/SystemControlPanel";
import QrConnectModal from "@/components/QrConnectModal";
import { useTelemetryStore } from "@/hooks/useTelemetryStore";
import { useMqtt } from "@/hooks/useMqtt";
import { MQTT_TOPICS, POI_SPOTS, haversineDistanceM } from "@/lib/mqttTopics";
import { fetchOsrmStreetRoute, getSimulatedTimestampMs } from "@/lib/mockData";
import {
  AnakTelemetry,
  DemoPreset,
  LiveTripRoute,
  PoiSpot,
  TimeLabel,
  TimeMode,
} from "@/lib/types";

function densifyCoords(
  coords: [number, number][],
  targetSteps: number
): [number, number][] {
  if (coords.length < 2) return coords;
  const result: [number, number][] = [];
  const segments = coords.length - 1;
  const stepsPerSeg = Math.max(2, Math.ceil(targetSteps / segments));

  for (let i = 0; i < segments; i++) {
    const [lat1, lon1] = coords[i];
    const [lat2, lon2] = coords[i + 1];
    for (let s = 0; s < stepsPerSeg; s++) {
      const t = s / stepsPerSeg;
      result.push([lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t]);
    }
  }
  result.push(coords[coords.length - 1]);
  return result;
}

function generateTripSteps(
  coords: [number, number][],
  targetSteps: number = 46
): [number, number][] {
  if (coords.length <= 2) return coords;
  if (coords.length >= targetSteps) {
    const result: [number, number][] = [];
    const step = (coords.length - 1) / (targetSteps - 1);
    for (let i = 0; i < targetSteps; i++) {
      const idx = Math.min(coords.length - 1, Math.round(i * step));
      result.push(coords[idx]);
    }
    return result;
  }
  return densifyCoords(coords, targetSteps);
}

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<NavTab>("overview");
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isTimeDropdownOpen, setIsTimeDropdownOpen] = useState(false);
  const timeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        timeDropdownRef.current &&
        !timeDropdownRef.current.contains(event.target as Node)
      ) {
        setIsTimeDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [isTripRunning, setIsTripRunning] = useState(false);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [dateDisplay, setDateDisplay] = useState("");
  const [clockDisplay, setClockDisplay] = useState("");

  const tripTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isTripRunningRef = useRef(false);
  const seqRef = useRef<number>(Math.floor(Date.now() / 200));

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setDateDisplay(
        now.toLocaleDateString("id-ID", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      );
      setClockDisplay(
        now.toLocaleTimeString("id-ID", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 1000);
    return () => clearInterval(timer);
  }, []);

  const {
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
  } = useTelemetryStore();

  const { isConnected, publishRaw, publishCommand } = useMqtt({
    onAnakTelemetry: (payload) => {
      if (isTripRunningRef.current) return;
      seqRef.current = Math.max(seqRef.current, payload.sequence || 0);
      ingestAnakTelemetry(payload);
    },
    onOrtuTelemetry: (payload) => {
      ingestOrtuTelemetry(payload);
    },
    onAlert: (payload) => {
      ingestServerAlert(payload);
    },
    onCommand: (topic, payload: any) => {
      const cmdName = topic.split("/").pop()?.toUpperCase() || "COMMAND";
      if (cmdName === "TIMEMODE") {
        if (payload.mode) {
          updateTimeMode(payload.mode);
        }
        const spotName = payload.spot_id
          ? POI_SPOTS.find((s) => s.id === payload.spot_id)?.name || payload.spot_id
          : null;
        const msgParts: string[] = [];
        if (payload.mode) msgParts.push(`waktu: ${payload.mode}`);
        if (spotName) msgParts.push(`lokasi: ${spotName}`);

        if (msgParts.length > 0) {
          addEventLog({
            sender: payload.triggered_by === "anak" ? "Perangkat Anak" : "Sistem",
            role: payload.triggered_by === "anak" ? "anak" : "dashboard",
            title: "Sinkronisasi Demo",
            message: `Mode diatur ke ${msgParts.join(", ")}`,
            severity: "info",
            meta: "MQTT Sync",
          });
        }
        return;
      }

      if (payload.triggered_by === "ortu") {
        addEventLog({
          sender: "Perangkat Orang Tua",
          role: "ortu",
          title: `Perintah ${cmdName}`,
          message: payload.message,
          severity: cmdName === "ALARM" ? "critical" : "info",
          meta: "Dari HP Ortu",
        });
      }
    },
  });

  const stopLiveTrip = useCallback(() => {
    if (tripTimerRef.current) {
      clearInterval(tripTimerRef.current);
      tripTimerRef.current = null;
    }
    isTripRunningRef.current = false;
    setIsTripRunning(false);
    setActiveTripId(null);
  }, []);

  useEffect(() => {
    return () => {
      if (tripTimerRef.current) clearInterval(tripTimerRef.current);
    };
  }, []);

  const handleApplyPreset = useCallback(
    (preset: DemoPreset) => {
      stopLiveTrip();
      setActiveRouteCoords([]);
      setActivePresetId(preset.id);
      clearTrail([preset.lat, preset.lon]);

      const nextSeq = Math.max(seqRef.current + 1, Math.floor(Date.now() / 200));
      seqRef.current = nextSeq;
      const rms = Number(Math.pow(10, (preset.db - 100) / 20).toFixed(6));
      const simulatedSentAtMs = getSimulatedTimestampMs(
        preset.time_display || preset.time_label,
        nextSeq
      );

      const matchedSpot = POI_SPOTS.find(
        (s) =>
          Math.abs(s.lat - preset.lat) < 0.0005 &&
          Math.abs(s.lon - preset.lon) < 0.0005
      );

      // Sinkronkan lokasi dan waktu ke HP Anak
      publishRaw(MQTT_TOPICS.COMMAND_TIMEMODE, {
        mode: preset.time_label,
        spot_id: matchedSpot?.id,
        db: preset.db,
        triggered_by: "dashboard",
        timestamp_ms: Date.now(),
      });

      const payload: AnakTelemetry = {
        device_id: "anak",
        sequence: nextSeq,
        sent_at_ms: simulatedSentAtMs,
        location: {
          lat: preset.lat,
          lon: preset.lon,
          accuracy_m: 5.0,
        },
        audio: {
          rms,
          db: preset.db,
        },
        motion: {
          accel_magnitude: 9.8,
        },
      };

      ingestAnakTelemetry(payload, preset.time_label);
      const ok = publishRaw(MQTT_TOPICS.ANAK_TELEMETRY, payload);

      if (!ok) {
        addEventLog({
          sender: "Simulasi Sistem",
          role: "dashboard",
          title: "MQTT Belum Terhubung",
          message: "Koneksi WSS ke broker sedang menghubungkan. Telemetri diupdate lokal.",
          severity: "warning",
          meta: "WSS Offline",
        });
      }

      addEventLog({
        sender: "Simulasi Sistem",
        role: "dashboard",
        title: `Skenario: ${preset.title}`,
        message: `Lokasi diatur ke ${preset.location_name}, suara ${preset.db} dB.`,
        severity: "info",
        meta: preset.time_display,
      });
    },
    [
      stopLiveTrip,
      setActiveRouteCoords,
      clearTrail,
      ingestAnakTelemetry,
      publishRaw,
      addEventLog,
    ]
  );

  const handleJumpToSpot = useCallback(
    (spot: PoiSpot) => {
      stopLiveTrip();
      setActiveRouteCoords([]);
      setActivePresetId(null);

      const defaultDb = spot.category === "bar" ? 84.0 : 49.0;
      const defaultTime: TimeLabel =
        spot.category === "bar" || spot.category === "kos"
          ? "jam_malam"
          : spot.category === "masjid"
          ? "waktu_sholat"
          : "jam_kuliah";

      const nextSeq = Math.max(seqRef.current + 1, Math.floor(Date.now() / 200));
      seqRef.current = nextSeq;
      const rms = Number(Math.pow(10, (defaultDb - 100) / 20).toFixed(6));
      const simulatedSentAtMs = getSimulatedTimestampMs(defaultTime, nextSeq);

      // Sinkronkan lokasi dan waktu ke HP Anak
      publishRaw(MQTT_TOPICS.COMMAND_TIMEMODE, {
        mode: defaultTime,
        spot_id: spot.id,
        triggered_by: "dashboard",
        timestamp_ms: Date.now(),
      });

      const payload: AnakTelemetry = {
        device_id: "anak",
        sequence: nextSeq,
        sent_at_ms: simulatedSentAtMs,
        location: {
          lat: spot.lat,
          lon: spot.lon,
          accuracy_m: 6.0,
        },
        audio: {
          rms,
          db: defaultDb,
        },
        motion: {
          accel_magnitude: 9.8,
        },
      };

      ingestAnakTelemetry(payload, defaultTime);
      const ok = publishRaw(MQTT_TOPICS.ANAK_TELEMETRY, payload);
      if (!ok) {
        addEventLog({
          sender: "Peta Interaktif",
          role: "dashboard",
          title: "MQTT Belum Terhubung",
          message: "Koneksi WSS ke broker sedang menghubungkan. Telemetri diupdate lokal.",
          severity: "warning",
          meta: "WSS Offline",
        });
      }
    },
    [stopLiveTrip, setActiveRouteCoords, ingestAnakTelemetry, publishRaw, addEventLog]
  );

  const handleStartLiveTrip = useCallback(
    async (route: LiveTripRoute) => {
      stopLiveTrip();
      setActivePresetId(null);
      isTripRunningRef.current = true;
      setIsTripRunning(true);
      setActiveTripId(route.id);

      const startPt = route.waypoints[0];
      const endPt = route.waypoints[route.waypoints.length - 1];

      const rawStreetCoords = await fetchOsrmStreetRoute(
        startPt[0],
        startPt[1],
        endPt[0],
        endPt[1],
        route.waypoints
      );

      const steps = generateTripSteps(rawStreetCoords, 46);
      setActiveRouteCoords(steps);
      clearTrail(steps[0]);

      addEventLog({
        sender: "Simulasi Perjalanan",
        role: "dashboard",
        title: route.name,
        message: `Perangkat bergerak dari ${route.fromName} menuju ${route.toName}.`,
        severity: "info",
        meta: `${steps.length} titik jalan`,
      });

      let idx = 0;
      tripTimerRef.current = setInterval(() => {
        if (idx >= steps.length) {
          stopLiveTrip();
          return;
        }

        const [lat, lon] = steps[idx];
        const isNearEnd = idx >= steps.length - 4;
        const currentDb = isNearEnd
          ? route.targetDb
          : 54.0 + Math.sin(idx * 0.6) * 4.5;

        const nextSeq = Math.max(seqRef.current + 1, Math.floor(Date.now() / 200));
        seqRef.current = nextSeq;
        const rms = Number(Math.pow(10, (currentDb - 100) / 20).toFixed(6));
        const simulatedSentAtMs = getSimulatedTimestampMs(
          route.time_label,
          nextSeq
        );
        const payload: AnakTelemetry = {
          device_id: "anak",
          sequence: nextSeq,
          sent_at_ms: simulatedSentAtMs,
          location: {
            lat: Number(lat.toFixed(6)),
            lon: Number(lon.toFixed(6)),
            accuracy_m: 7.5,
          },
          audio: {
            rms,
            db: Number(currentDb.toFixed(1)),
          },
          motion: {
            accel_magnitude: isNearEnd ? 9.8 : 13.4,
          },
        };

        const destCoord = steps[steps.length - 1];
        const remainingDistM = haversineDistanceM(
          lat,
          lon,
          destCoord[0],
          destCoord[1]
        );

        ingestAnakTelemetry(payload, route.time_label, {
          destinationName: route.toName,
          distanceToDestM: remainingDistM,
        });
        publishRaw(MQTT_TOPICS.ANAK_TELEMETRY, payload);
        idx += 1;
      }, 600);
    },
    [
      stopLiveTrip,
      setActiveRouteCoords,
      clearTrail,
      addEventLog,
      ingestAnakTelemetry,
      publishRaw,
    ]
  );

  const handleSendCommand = useCallback(
    (type: "ping" | "reminder" | "alarm", customMessage?: string) => {
      const sent = publishCommand(type, customMessage, "dashboard");
      const titleMap = {
        ping: "Perintah Ping Dikirim",
        reminder: "Pengingat Dikirim",
        alarm: "Alarm Darurat Dikirim",
      };
      addEventLog({
        sender: "Panel Kontrol Sistem",
        role: "dashboard",
        title: titleMap[type],
        message: sent.message,
        severity: type === "alarm" ? "critical" : "info",
        meta: "Ke Perangkat Anak",
      });
    },
    [publishCommand, addEventLog]
  );

  const activeTimeDesc: Record<TimeLabel, string> = {
    jam_kuliah: "Jam Kuliah",
    waktu_sholat: "Waktu Sholat",
    jam_malam: "Jam Malam",
    lainnya: "Normal",
  };

  const timeSimulationOptions: {
    id: TimeMode;
    label: string;
    badge: string;
  }[] = [
    {
      id: "auto",
      label: "Otomatis (Ikuti Jam Asli)",
      badge: "Otomatis",
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
      label: "Simulasi Jam Santai / Normal",
      badge: "16:00 WIB",
    },
  ];

  const currentOption =
    timeSimulationOptions.find((opt) => opt.id === timeMode) ||
    timeSimulationOptions[0];

  return (
    <div className="min-h-screen bg-[#ECEFF4] p-0 lg:p-4 flex items-stretch justify-center">
      {/* Container Utama 3 Kolom */}
      <div className="w-full max-w-[1640px] rounded-none lg:rounded-[34px] bg-white/90 backdrop-blur-2xl border border-white shadow-[0_20px_60px_-15px_rgba(15,23,42,0.08)] flex flex-col lg:flex-row overflow-hidden">
        {/* Mobile Header Bar (Khusus Layar < lg: Minimalis Logo + Hamburger) */}
        <div className="lg:hidden flex items-center justify-between px-5 py-3.5 bg-white/90 backdrop-blur-xl border-b border-slate-200/80 shrink-0 select-none">
          <img
            src="/logo.png"
            alt="ISDUGEM?!"
            className="h-7 w-auto object-contain"
          />
          <button
            type="button"
            onClick={() => setIsMobileDrawerOpen(true)}
            aria-label="Buka Menu Navigasi"
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 flex items-center justify-center shrink-0 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* Kolom 1: Sidebar Kiri (Desktop Aside + Mobile Drawer) */}
        <Sidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          onOpenQrModal={() => setQrModalOpen(true)}
          isMqttConnected={isConnected}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
          isMobileOpen={isMobileDrawerOpen}
          onCloseMobile={() => setIsMobileDrawerOpen(false)}
        />

        {/* Kolom 2: Area Utama Tengah */}
        <main className="flex-1 min-w-0 p-5 sm:p-7 overflow-y-auto space-y-5 bg-[#F8FAFC]/60">
          {/* Header Tengah (Dashboard Umum) */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 pb-2 border-b border-slate-200/70">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Dashboard Pemantauan
              </h1>
            </div>

            {/* Tanggal, Jam Real-time & Dropdown Mode Waktu Demo */}
            <div
              className={`flex gap-2 ${
                isSidebarCollapsed
                  ? "flex-col sm:flex-row sm:items-center"
                  : "flex-col items-start sm:items-end 2xl:flex-row 2xl:items-center"
              }`}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-white border border-slate-200/80 text-xs font-semibold text-slate-700 shadow-sm shrink-0">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>{dateDisplay}</span>
                {clockDisplay && (
                  <span className="font-mono text-slate-900 border-l border-slate-200 pl-2">
                    {timeMode === "auto" ? `${clockDisplay} WIB` : currentOption.badge}
                  </span>
                )}
              </div>

              {/* Solusi A: Dropdown Mode Waktu Demo */}
              <div className="relative shrink-0" ref={timeDropdownRef}>
                <button
                  type="button"
                  onClick={() => setIsTimeDropdownOpen((prev) => !prev)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl bg-white border border-slate-200/80 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50 transition-all shrink-0"
                >
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-slate-800">
                    {timeMode === "auto"
                      ? `Mode: Otomatis (${activeTimeDesc[activeTimeLabel]})`
                      : `Mode: ${currentOption.label}`}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
                      isTimeDropdownOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isTimeDropdownOpen && (
                  <div className="absolute right-0 mt-1.5 w-72 rounded-2xl bg-white/95 backdrop-blur-xl border border-slate-200 shadow-xl p-1.5 z-50 space-y-1">
                    <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                      Pilih Konteks Waktu Demo
                    </div>
                    {timeSimulationOptions.map((opt) => {
                      const isSelected = timeMode === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            updateTimeMode(opt.id);
                            publishRaw(MQTT_TOPICS.COMMAND_TIMEMODE, {
                              mode: opt.id,
                              triggered_by: "dashboard",
                              timestamp_ms: Date.now(),
                            });

                            // Kirim ulang telemetri terakhir dengan jam baru agar server langsung mengevaluasi
                            if (latestTelemetry.sent_at_ms > 0) {
                              const nextSeq = Math.max(
                                seqRef.current + 1,
                                Math.floor(Date.now() / 200)
                              );
                              seqRef.current = nextSeq;
                              const newSentAtMs =
                                opt.id === "auto"
                                  ? Date.now()
                                  : getSimulatedTimestampMs(opt.id, nextSeq);
                              const updatedPayload: AnakTelemetry = {
                                ...latestTelemetry,
                                sequence: nextSeq,
                                sent_at_ms: newSentAtMs,
                              };
                              publishRaw(MQTT_TOPICS.ANAK_TELEMETRY, updatedPayload);
                            }

                            setIsTimeDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-all ${
                            isSelected
                              ? "bg-slate-100 font-bold text-slate-900"
                              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                          }`}
                        >
                          <span className="font-semibold text-slate-800 truncate mr-2">
                            {opt.label}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-mono font-medium">
                              {opt.badge}
                            </span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 3 Metrik KPI Strip */}
          <KpiStrip
            telemetry={latestTelemetry}
            alert={latestAlert}
            speedKmh={speedKmh}
          />

          {/* Konten Dinamis Berdasarkan Tab Navigasi */}
          {activeTab === "overview" && (
            <>
              <MapPanel
                telemetry={latestTelemetry}
                ortuTelemetry={latestOrtuTelemetry}
                alert={latestAlert}
                trailCoords={trailCoords}
                activeRouteCoords={activeRouteCoords}
                isTripRunning={isTripRunning}
                activeTripId={activeTripId}
                onStartLiveTrip={handleStartLiveTrip}
                onStopLiveTrip={stopLiveTrip}
                onJumpToSpot={handleJumpToSpot}
              />

              <HistoryChart data={history} />

              <DemoPresetPanel
                activePresetId={activePresetId}
                onApplyPreset={handleApplyPreset}
              />
            </>
          )}

          {activeTab === "map" && (
            <MapPanel
              telemetry={latestTelemetry}
              ortuTelemetry={latestOrtuTelemetry}
              alert={latestAlert}
              trailCoords={trailCoords}
              activeRouteCoords={activeRouteCoords}
              isTripRunning={isTripRunning}
              activeTripId={activeTripId}
              onStartLiveTrip={handleStartLiveTrip}
              onStopLiveTrip={stopLiveTrip}
              onJumpToSpot={handleJumpToSpot}
              expanded={true}
            />
          )}

          {activeTab === "analytics" && (
            <>
              <HistoryChart data={history} />
              <DemoPresetPanel
                activePresetId={activePresetId}
                onApplyPreset={handleApplyPreset}
              />
            </>
          )}

          {activeTab === "simulator" && (
            <>
              <DemoPresetPanel
                activePresetId={activePresetId}
                onApplyPreset={handleApplyPreset}
              />
              <MapPanel
                telemetry={latestTelemetry}
                ortuTelemetry={latestOrtuTelemetry}
                alert={latestAlert}
                trailCoords={trailCoords}
                activeRouteCoords={activeRouteCoords}
                isTripRunning={isTripRunning}
                activeTripId={activeTripId}
                onStartLiveTrip={handleStartLiveTrip}
                onStopLiveTrip={stopLiveTrip}
                onJumpToSpot={handleJumpToSpot}
              />
            </>
          )}
        </main>

        {/* Kolom 3: Panel Kontrol Sistem (Sisi Kanan) */}
        <SystemControlPanel
          telemetry={latestTelemetry}
          ortuTelemetry={latestOrtuTelemetry}
          alert={latestAlert}
          events={events}
          onClearEvents={clearEvents}
          onSendCommand={handleSendCommand}
        />
      </div>

      {/* Modal Kode QR */}
      <QrConnectModal
        isOpen={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
      />
    </div>
  );
}
