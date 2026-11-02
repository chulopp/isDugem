"use client";

import React from "react";
import { Alert, AnakTelemetry, TimeLabel } from "@/lib/types";
import { ML_PRODUCTION_META } from "@/lib/mlModelMeta";
import { computeDistancesToServerPois } from "@/lib/mqttTopics";

interface MlXaiPanelProps {
  telemetry: AnakTelemetry;
  alert: Alert;
  activeTimeLabel: TimeLabel;
}

function getSimulatedMinute(timeLabel: TimeLabel): number {
  if (timeLabel === "jam_kuliah") return 9 * 60 + 0; // 09:00 WIB
  if (timeLabel === "waktu_sholat") return 12 * 60 + 15; // 12:15 WIB
  if (timeLabel === "jam_malam") return 23 * 60 + 0; // 23:00 WIB
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export default function MlXaiPanel({
  telemetry,
  alert,
  activeTimeLabel,
}: MlXaiPanelProps) {
  const mlMeta = alert.ml_meta;

  // Hitung nilai live 8 fitur input model
  const serverDists = computeDistancesToServerPois(
    telemetry.location.lat,
    telemetry.location.lon
  );

  const minute = getSimulatedMinute(activeTimeLabel);
  const timeSin = Math.sin((2 * Math.PI * minute) / 1440);
  const timeCos = Math.cos((2 * Math.PI * minute) / 1440);
  const speed = telemetry.location.speed_mps ?? 0;
  const db = telemetry.audio.db;

  const liveFeatures = [
    {
      key: "time_cos",
      label: "Waktu (Cosinus)",
      value: timeCos.toFixed(4),
      unit: "cos",
    },
    {
      key: "db_level",
      label: "Tingkat Suara",
      value: db.toFixed(1),
      unit: "dB",
    },
    {
      key: "dist_kos_m",
      label: "Jarak ke Kos",
      value: Math.round(serverDists.distKos).toString(),
      unit: "m",
    },
    {
      key: "time_sin",
      label: "Waktu (Sinus)",
      value: timeSin.toFixed(4),
      unit: "sin",
    },
    {
      key: "dist_bar_m",
      label: "Jarak ke Bar",
      value: Math.round(serverDists.distBar).toString(),
      unit: "m",
    },
    {
      key: "dist_kampus_m",
      label: "Jarak ke Kampus",
      value: Math.round(serverDists.distKampus).toString(),
      unit: "m",
    },
    {
      key: "dist_masjid_m",
      label: "Jarak ke Masjid",
      value: Math.round(serverDists.distMasjid).toString(),
      unit: "m",
    },
    {
      key: "speed_mps",
      label: "Kecepatan GPS",
      value: speed.toFixed(1),
      unit: "m/s",
    },
  ];

  return (
    <div className="space-y-4">
      {/* Kartu Utama: Ringkasan Analisis Model */}
      <div className="rounded-3xl bg-white/90 backdrop-blur-xl border border-slate-200/80 shadow-glass p-5 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-100">
          <h3 className="text-sm sm:text-base font-bold text-slate-900">
            Analisis Model Machine Learning
          </h3>
        </div>

        {/* 4 Kotak Metrik Ringkas Model */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Metrik 1: Keyakinan */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Tingkat Keyakinan
            </span>
            <div className="text-lg sm:text-xl font-bold text-slate-900">
              {mlMeta ? `${(mlMeta.confidence * 100).toFixed(1)}%` : "100.0%"}
            </div>
            <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2.5 overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                style={{
                  width: `${mlMeta ? Math.min(100, Math.max(10, mlMeta.confidence * 100)) : 100}%`,
                }}
              />
            </div>
          </div>

          {/* Metrik 2: Skor Anomali IF */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Skor Anomali IF
            </span>
            <div
              className={`text-lg sm:text-xl font-bold ${
                mlMeta?.is_anomaly ? "text-rose-600" : "text-emerald-700"
              }`}
            >
              {mlMeta ? mlMeta.anomaly_score.toFixed(3) : "0.000"}
            </div>
          </div>

          {/* Metrik 3: Akurasi Model (CV) */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Akurasi Model (CV)
            </span>
            <div className="text-lg sm:text-xl font-bold text-slate-900">
              {(ML_PRODUCTION_META.rf_cv5_accuracy_mean * 100).toFixed(1)}%
            </div>
          </div>

          {/* Metrik 4: Latensi Inferensi */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
            <span className="text-[11px] font-semibold text-slate-500 block mb-1">
              Latensi Inferensi
            </span>
            <div className="text-lg sm:text-xl font-bold text-emerald-700">
              &lt; 1.0 ms
            </div>
          </div>
        </div>
      </div>

      {/* Grid 2 Kolom: Inspektor Fitur Live & Bobot Fitur (Feature Importance) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Kolom Kiri: Fitur Input Real-Time */}
        <div className="rounded-3xl bg-white/90 backdrop-blur-xl border border-slate-200/80 shadow-glass p-5 space-y-3.5">
          <div className="pb-2 border-b border-slate-100">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900">
              Fitur Input Real-Time
            </h4>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {liveFeatures.map((feat) => (
              <div
                key={feat.key}
                className="p-3 rounded-2xl border bg-slate-50/80 border-slate-200/70"
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-xs font-semibold text-slate-600 truncate">
                    {feat.label}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400 shrink-0">
                    {feat.unit}
                  </span>
                </div>
                <div className="text-base sm:text-lg font-bold text-slate-900">
                  {feat.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Kolom Kanan: Bobot Pengaruh Fitur (Feature Importance) */}
        <div className="rounded-3xl bg-white/90 backdrop-blur-xl border border-slate-200/80 shadow-glass p-5 space-y-3.5 flex flex-col justify-between">
          <div>
            <div className="pb-2 border-b border-slate-100 mb-3">
              <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                Feature Importance (Kontribusi Keputusan)
              </h4>
            </div>

            {/* Daftar Batang Horizontal Feature Importance */}
            <div className="space-y-2.5">
              {ML_PRODUCTION_META.features.map((item, idx) => {
                const maxPct = ML_PRODUCTION_META.features[0].percentage;
                const relWidth = Math.max(6, Math.round((item.percentage / maxPct) * 100));

                return (
                  <div key={item.key} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                        <span className="text-[10px] font-mono text-slate-400">
                          #{idx + 1}
                        </span>
                        <span>{item.display_name}</span>
                      </span>
                      <span className="font-bold text-indigo-700 font-mono">
                        {item.percentage.toFixed(1)}%
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-all duration-500"
                        style={{ width: `${relWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-2.5 border-t border-slate-100 text-[11px] text-slate-500">
            Fitur paling dominan: Waktu & Suara
          </div>
        </div>
      </div>
    </div>
  );
}
