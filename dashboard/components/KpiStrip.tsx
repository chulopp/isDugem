"use client";

import React from "react";
import { ShieldAlert, ShieldCheck, Volume2, Navigation } from "lucide-react";
import { Alert, AnakTelemetry } from "@/lib/types";
import {
  STATUS_DISPLAY,
  computeDistancesToCategories,
} from "@/lib/mqttTopics";

interface KpiStripProps {
  telemetry: AnakTelemetry;
  alert: Alert;
  speedKmh: number;
}

export default function KpiStrip({
  telemetry,
  alert,
  speedKmh,
}: KpiStripProps) {
  const statusInfo = STATUS_DISPLAY[alert.status] || STATUS_DISPLAY.NORMAL;
  const db = telemetry.audio.db;

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

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 md:gap-3 xl:gap-4 py-3 px-3.5 sm:px-4.5 rounded-3xl bg-white/80 backdrop-blur-xl border border-slate-200/80 shadow-glass">
        {/* KPI 1: Status Sistem */}
        <div className="flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-200/70 pb-2.5 md:pb-0 md:pr-2.5 xl:pr-4 min-w-0 overflow-hidden">
          {/* Baris Atas: Ikon + Label (dan badge di layar monitor besar) */}
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
            <span
              className={`hidden xl:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${statusInfo.badgeBg} ${statusInfo.badgeText}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusInfo.dotColor}`} />
              <span className="truncate max-w-[65px]">{statusInfo.shortLabel}</span>
            </span>
          </div>

          {/* Baris Bawah: Status Utama Selebar Kolom */}
          <div className="mt-1.5 min-w-0">
            <span
              className="block text-xs sm:text-sm xl:text-base font-bold text-slate-900 tracking-tight truncate"
              title={statusInfo.label}
            >
              {statusInfo.label}
            </span>
          </div>
        </div>

        {/* KPI 2: Tingkat Suara (Audio Visualizer) */}
        <div className="flex flex-col justify-between border-b md:border-b-0 md:border-r border-slate-200/70 pb-2.5 md:pb-0 md:px-2.5 xl:px-4 min-w-0 overflow-hidden">
          {/* Baris Atas: Ikon + Label & Mini Equalizer */}
          <div className="flex items-center justify-between gap-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <Volume2 className="w-4 h-4 shrink-0 text-slate-600" />
              <p className="text-xs font-semibold text-slate-500 truncate">
                Tingkat Suara
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

          {/* Baris Bawah: Angka Desibel + Kategori */}
          <div className="mt-1.5 flex items-baseline gap-1.5 min-w-0">
            <span className="text-xs sm:text-sm xl:text-base font-bold text-slate-900 shrink-0">
              {db.toFixed(1)} <span className="text-[11px] font-semibold text-slate-400">dB</span>
            </span>
            <span className={`text-xs font-semibold truncate ${dbCategory.color}`}>
              • {dbCategory.label}
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
            {speedKmh > 0 && (
              <span className="px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700 text-[10px] font-semibold shrink-0">
                {speedKmh} km/j
              </span>
            )}
          </div>

          {/* Baris Bawah: Jarak dan Nama Lokasi */}
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
        </div>
      </div>

      {/* Baris Keterangan Alasan Status */}
      <div
        className={`px-4 py-2.5 rounded-2xl border text-xs font-medium flex items-center justify-between min-h-[42px] ${statusInfo.badgeBg} ${statusInfo.borderColor} ${statusInfo.badgeText}`}
      >
        <span className="truncate mr-2 flex-1 min-w-0">Keterangan: {alert.reason}</span>
        <span className="font-mono text-[11px] opacity-80 shrink-0 whitespace-nowrap">
          Gerak: {telemetry.motion.accel_magnitude.toFixed(1)} m/s²
        </span>
      </div>
    </div>
  );
}
