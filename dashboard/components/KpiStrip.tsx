"use client";

import React from "react";
import { ShieldAlert, ShieldCheck, Volume2, Navigation, Brain, Sparkles, Activity } from "lucide-react";
import { Alert, AnakTelemetry } from "@/lib/types";
import {
  STATUS_DISPLAY,
  computeDistancesToCategories,
} from "@/lib/mqttTopics";

interface KpiStripProps {
  telemetry: AnakTelemetry;
  alert: Alert;
  speedMps: number | null;
  speedKmh: number | null;
}

export default function KpiStrip({
  telemetry,
  alert,
  speedMps,
  speedKmh,
}: KpiStripProps) {
  const isServerWaiting = alert.timestamp_ms === 0;
  const statusInfo = STATUS_DISPLAY[alert.status] || STATUS_DISPLAY.NORMAL;
  const db = telemetry.audio.db;
  const mlMeta = alert.ml_meta;

  const { nearestSpot, nearestSpotDist } = computeDistancesToCategories(
    telemetry.location.lat,
    telemetry.location.lon
  );

  const dbCategory =
    db > 75
      ? { label: "Bising", color: "text-rose-600", barColor: "bg-rose-500" }
      : db >= 55
      ? { label: "Sedang", color: "text-amber-600", barColor: "bg-amber-500" }
      : { label: "Tenang", color: "text-emerald-600", barColor: "bg-emerald-500" };

  const bars = [0.45, 0.75, 1.0, 0.65, 0.85];

  // Penentuan label gerak berdasarkan speed_mps
  let motionContextLabel = "Diam";
  let motionContextBadge = "bg-slate-100 text-slate-700";
  if (speedMps !== null) {
    if (speedMps >= 2.5) {
      motionContextLabel = "Berkendara";
      motionContextBadge = "bg-sky-100 text-sky-800";
    } else if (speedMps >= 0.5) {
      motionContextLabel = "Berjalan";
      motionContextBadge = "bg-emerald-100 text-emerald-800";
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 md:gap-3 xl:gap-4 py-3 px-3.5 sm:px-4.5 rounded-3xl bg-white/80 backdrop-blur-xl border border-slate-200/80 shadow-glass">
        {/* KPI 1: Status Sistem & Mesin AI */}
        <div className="flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-200/70 pb-2.5 md:pb-0 md:pr-2.5 xl:pr-4 min-w-0 overflow-hidden">
          {/* Baris Atas: Ikon + Label & Engine Badge */}
          <div className="flex items-center justify-between gap-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              {statusInfo.severity === "critical" ? (
                <ShieldAlert className={`w-4 h-4 shrink-0 ${statusInfo.badgeText}`} />
              ) : (
                <ShieldCheck className={`w-4 h-4 shrink-0 ${statusInfo.badgeText}`} />
              )}
              <p className="text-xs font-semibold text-slate-500 truncate">
                Status Sistem
              </p>
            </div>

            {/* Badge Mode Keputusan (ML vs Fallback vs Menunggu) */}
            {isServerWaiting ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0 animate-pulse" />
                <span>Menunggu Server</span>
              </span>
            ) : mlMeta ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/80 shrink-0">
                <Brain className="w-3 h-3 text-indigo-600 shrink-0" />
                <span className="truncate max-w-[120px]">ML: Random Forest</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/80 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                <span className="truncate max-w-[120px]">Rule-Based</span>
              </span>
            )}
          </div>

          {/* Baris Tengah: Status Utama */}
          <div className="mt-1.5 min-w-0">
            <span
              className="block text-xs sm:text-sm xl:text-base font-bold text-slate-900 tracking-tight truncate"
              title={isServerWaiting ? "Menunggu respon alert dari server..." : statusInfo.label}
            >
              {isServerWaiting ? "Menunggu Verifikasi Server" : statusInfo.label}
            </span>
          </div>

          {/* Baris Bawah: Skor Keyakinan & Anomali Isolation Forest */}
          {mlMeta && !isServerWaiting && (
            <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-1 text-[11px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles className="w-3 h-3 text-indigo-600 shrink-0" />
                <span className="text-slate-500 truncate">Keyakinan:</span>
                <span className="font-bold text-indigo-700 shrink-0">
                  {(mlMeta.confidence * 100).toFixed(1)}%
                </span>
                {/* Mini bar keyakinan */}
                <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden shrink-0 hidden sm:block">
                  <div
                    className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(10, mlMeta.confidence * 100))}%` }}
                  />
                </div>
              </div>

              {/* Status Isolation Forest */}
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold shrink-0 ${
                  mlMeta.is_anomaly
                    ? "bg-rose-100 text-rose-800 border border-rose-200"
                    : "bg-emerald-50 text-emerald-700 border border-emerald-200/70"
                }`}
                title={`Skor Anomali Isolation Forest: ${mlMeta.anomaly_score.toFixed(4)} (< 0 = Outlier)`}
              >
                {mlMeta.is_anomaly ? "IF: Anomali" : "IF: Normal"}
              </span>
            </div>
          )}
        </div>

        {/* KPI 2: Tingkat Suara (Audio Visualizer Raw) */}
        <div className="flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-200/70 pb-2.5 md:pb-0 md:px-2.5 xl:px-4 min-w-0 overflow-hidden">
          {/* Baris Atas: Ikon + Label & Mini Equalizer */}
          <div className="flex items-center justify-between gap-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <Volume2 className="w-4 h-4 shrink-0 text-slate-600" />
              <p className="text-xs font-semibold text-slate-500 truncate">
                Suara Relatif (Raw)
              </p>
            </div>
            {/* Mini Equalizer di baris atas kanan */}
            <div className="flex items-end gap-0.5 h-3 shrink-0">
              {bars.map((mult, idx) => {
                const pct = Math.max(
                  20,
                  Math.min(100, Math.round((db / 100) * mult * 100))
                );
                return (
                  <span
                    key={idx}
                    style={{ height: `${pct}%` }}
                    className={`w-0.5 rounded-full transition-all duration-300 ${dbCategory.barColor}`}
                  />
                );
              })}
            </div>
          </div>

          {/* Baris Tengah: Angka Desibel + Kategori Visual */}
          <div className="mt-1.5 flex items-baseline gap-1.5 min-w-0">
            <span className="text-xs sm:text-sm xl:text-base font-bold text-slate-900 shrink-0">
              {db.toFixed(1)} <span className="text-[11px] font-semibold text-slate-400">dB</span>
            </span>
            <span className={`text-xs font-semibold truncate ${dbCategory.color}`}>
              • {dbCategory.label}
            </span>
          </div>

          {/* Baris Bawah: Catatan Mikrofon Raw */}
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span className="truncate">Sensitivitas Mikrofon HP</span>
            <span className="font-mono text-[10px] text-slate-400 shrink-0">
              RMS: {telemetry.audio.rms.toFixed(4)}
            </span>
          </div>
        </div>

        {/* KPI 3: Jarak & Kecepatan */}
        <div className="flex flex-col justify-between md:pl-2.5 xl:pl-4 min-w-0 overflow-hidden">
          {/* Baris Atas: Ikon + Label & Kecepatan */}
          <div className="flex items-center justify-between gap-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <Navigation className="w-4 h-4 shrink-0 text-slate-600" />
              <p className="text-xs font-semibold text-slate-500 truncate">
                Titik Terdekat
              </p>
            </div>
            {/* Kecepatan dari location.speed_mps */}
            <span className="px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700 text-[10px] font-semibold shrink-0">
              {speedKmh !== null && speedMps !== null
                ? `${speedKmh} km/j (${speedMps.toFixed(1)} m/s)`
                : telemetry.sent_at_ms > 0
                ? "- km/j"
                : "0 km/j"}
            </span>
          </div>

          {/* Baris Tengah: Jarak dan Nama Spot Peta */}
          <div className="mt-1.5 flex items-baseline gap-1.5 min-w-0">
            <span className="text-xs sm:text-sm xl:text-base font-bold text-slate-900 shrink-0">
              {Math.round(nearestSpotDist)} <span className="text-[11px] font-semibold text-slate-400">m</span>
            </span>
            <span
              className="text-xs font-medium text-slate-600 truncate min-w-0 flex-1"
              title={nearestSpot.name}
            >
              {nearestSpot.name}
            </span>
          </div>

          {/* Baris Bawah: Jarak Pusat Zona Server */}
          <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
            <span className="truncate">
              {alert.context?.nearest_poi
                ? `Zona Server: ${alert.context.nearest_poi}`
                : "Zona Server: -"}
            </span>
            <span className="font-mono text-[10px] text-slate-600 font-semibold shrink-0">
              {alert.context?.distance_m !== undefined
                ? `${Math.round(alert.context.distance_m)} m`
                : "-"}
            </span>
          </div>
        </div>
      </div>

      {/* Baris Keterangan Alasan Status */}
      <div
        className={`px-4 py-2.5 rounded-2xl border text-xs font-medium flex items-center justify-between min-h-[42px] ${statusInfo.badgeBg} ${statusInfo.borderColor} ${statusInfo.badgeText}`}
      >
        <span className="truncate mr-2 flex-1 min-w-0">
          Keterangan: {alert.reason}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${motionContextBadge}`}>
            {motionContextLabel}
          </span>
          <span className="font-mono text-[11px] opacity-80 shrink-0 whitespace-nowrap">
            Aksel: {telemetry.motion.accel_magnitude.toFixed(1)} m/s²
          </span>
        </div>
      </div>
    </div>
  );
}
