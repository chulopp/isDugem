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

  const bars = [0.45, 0.75, 1.0, 0.65, 0.85, 0.5];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-4 px-5 rounded-3xl bg-white/80 backdrop-blur-xl border border-slate-200/80 shadow-glass min-h-[88px]">
        {/* KPI 1: Status Sistem */}
        <div className="flex items-center gap-3.5 md:border-r border-slate-200/70 md:pr-4 min-w-0">
          <div
            className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 border ${statusInfo.badgeBg} ${statusInfo.borderColor}`}
          >
            {statusInfo.severity === "critical" ? (
              <ShieldAlert className={`w-5 h-5 ${statusInfo.badgeText}`} />
            ) : (
              <ShieldCheck className={`w-5 h-5 ${statusInfo.badgeText}`} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-400">Status Sistem</p>
            <div className="flex items-center gap-2 mt-0.5 flex-nowrap min-w-0">
              <span className="text-sm font-bold text-slate-900 tracking-tight truncate shrink-0">
                {statusInfo.label}
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${statusInfo.badgeBg} ${statusInfo.badgeText}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotColor}`} />
                {statusInfo.shortLabel}
              </span>
            </div>
          </div>
        </div>

        {/* KPI 2: Tingkat Suara (Audio Visualizer) */}
        <div className="flex items-center gap-3.5 md:border-r border-slate-200/70 md:px-2 min-w-0">
          <div className="w-11 h-11 rounded-full bg-slate-100/90 border border-slate-200/70 flex items-center justify-center shrink-0">
            <Volume2 className="w-5 h-5 text-slate-700" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-400">Tingkat Suara</p>
            <div className="flex items-center gap-2.5 mt-0.5">
              <span className="text-base font-bold text-slate-900 shrink-0">
                {db.toFixed(1)} dB
              </span>
              <span className={`text-xs font-semibold shrink-0 ${dbCategory.color}`}>
                {dbCategory.label}
              </span>
              {/* Mini Equalizer */}
              <div className="flex items-end gap-0.5 h-4 ml-auto pr-2 shrink-0">
                {bars.map((mult, idx) => {
                  const pct = Math.max(
                    18,
                    Math.min(100, Math.round((db / 100) * mult * 100))
                  );
                  return (
                    <span
                      key={idx}
                      style={{ height: `${pct}%` }}
                      className={`w-1 rounded-full transition-all duration-300 ${dbCategory.barColor}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* KPI 3: Jarak & Kecepatan */}
        <div className="flex items-center gap-3.5 md:pl-2 min-w-0">
          <div className="w-11 h-11 rounded-full bg-slate-100/90 border border-slate-200/70 flex items-center justify-center shrink-0">
            <Navigation className="w-5 h-5 text-slate-700" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-400">
              Titik Terdekat
            </p>
            <div className="flex items-center gap-2 mt-0.5 flex-nowrap min-w-0">
              <span className="text-base font-bold text-slate-900 shrink-0">
                {Math.round(nearestSpotDist)} m
              </span>
              <span className="text-xs font-semibold text-slate-600 truncate flex-1 min-w-0" title={nearestSpot.name}>
                {nearestSpot.name}
              </span>
              {speedKmh > 0 && (
                <span className="px-1.5 py-0.5 rounded-md bg-sky-50 text-sky-700 text-[11px] font-semibold shrink-0">
                  {speedKmh} km/j
                </span>
              )}
            </div>
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
