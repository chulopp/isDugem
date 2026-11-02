"use client";

import React from "react";
import {
  Brain,
  Cpu,
  BarChart3,
  ShieldAlert,
  ShieldCheck,
  Zap,
  Activity,
  Layers,
  Sparkles,
  Info,
} from "lucide-react";
import { Alert, AnakTelemetry, TimeLabel } from "@/lib/types";
import {
  ML_PRODUCTION_META,
  FeatureImportanceItem,
  ModelComparisonItem,
} from "@/lib/mlModelMeta";
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
  const isMlActive = !!mlMeta;

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
      label: "Waktu Siklikal Cosinus",
      short: "time_cos",
      value: timeCos.toFixed(4),
      desc: "Transformasi trigonometri waktu 24 jam",
      unit: "cos",
      highlight: true,
    },
    {
      key: "db_level",
      label: "Tingkat Suara Suasana",
      short: "db_level",
      value: db.toFixed(1),
      desc: "Amplitudo suara mikrofon HP (mode raw)",
      unit: "dB",
      highlight: true,
    },
    {
      key: "dist_kos_m",
      label: "Jarak ke Zona Kos",
      short: "dist_kos_m",
      value: Math.round(serverDists.distKos).toString(),
      desc: "Haversine ke titik pusat Kos Mulawarman",
      unit: "m",
      highlight: false,
    },
    {
      key: "time_sin",
      label: "Waktu Siklikal Sinus",
      short: "time_sin",
      value: timeSin.toFixed(4),
      desc: "Kontinuitas pergantian hari 23:59 ke 00:01",
      unit: "sin",
      highlight: false,
    },
    {
      key: "dist_bar_m",
      label: "Jarak ke Zona Bar",
      short: "dist_bar_m",
      value: Math.round(serverDists.distBar).toString(),
      desc: "Haversine ke titik pusat Bar Kota Lama",
      unit: "m",
      highlight: false,
    },
    {
      key: "dist_kampus_m",
      label: "Jarak ke Kampus",
      short: "dist_kampus_m",
      value: Math.round(serverDists.distKampus).toString(),
      desc: "Haversine ke Kampus UNDIP Tembalang",
      unit: "m",
      highlight: false,
    },
    {
      key: "dist_masjid_m",
      label: "Jarak ke Masjid",
      short: "dist_masjid_m",
      value: Math.round(serverDists.distMasjid).toString(),
      desc: "Haversine ke Masjid Kampus UNDIP",
      unit: "m",
      highlight: false,
    },
    {
      key: "speed_mps",
      label: "Kecepatan Perangkat",
      short: "speed_mps",
      value: speed.toFixed(1),
      desc: "Delta koordinat GPS perangkat edge",
      unit: "m/s",
      highlight: false,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Kartu Utama: Arsitektur Dual-Engine & Status Keputusan Real-Time */}
      <div className="rounded-3xl bg-white/90 backdrop-blur-xl border border-slate-200/80 shadow-glass p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-50 border border-indigo-200/80 flex items-center justify-center text-indigo-700">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900">
                  Explainable AI (XAI) & Observabilitas Model
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">
                  v{ML_PRODUCTION_META.bundle_version}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Transparansi keputusan klasifikasi multi-kelas Random Forest dan deteksi anomali Isolation Forest.
              </p>
            </div>
          </div>

          {/* Badge Status Engine */}
          <div className="flex items-center gap-2">
            {isMlActive ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                <span>Mesin Aktif: Random Forest + IF</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 shadow-xs">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <span>Cadangan: Rule-Based Fallback</span>
              </span>
            )}
          </div>
        </div>

        {/* 4 Kartu Metrik Cepat Model */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Metrik 1: Keyakinan / Confidence */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-semibold">Tingkat Keyakinan</span>
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg sm:text-xl font-bold text-slate-900">
                {mlMeta ? `${(mlMeta.confidence * 100).toFixed(1)}%` : "100.0%"}
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                {mlMeta ? "Probabilitas RF" : "Logika Deterministik"}
              </span>
            </div>
            {/* Progress Bar Confidence */}
            <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
              <div
                className="h-full bg-indigo-600 rounded-full transition-all duration-300"
                style={{
                  width: `${mlMeta ? Math.min(100, Math.max(10, mlMeta.confidence * 100)) : 100}%`,
                }}
              />
            </div>
          </div>

          {/* Metrik 2: Isolation Forest Outlier */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-semibold">Skor Anomali IF</span>
              <Activity className="w-3.5 h-3.5 text-slate-600" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-lg sm:text-xl font-bold ${
                  mlMeta?.is_anomaly ? "text-rose-600" : "text-emerald-700"
                }`}
              >
                {mlMeta ? mlMeta.anomaly_score.toFixed(3) : "0.000"}
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                {mlMeta?.is_anomaly ? "Terindikasi Outlier" : "Pola Normal (>= 0)"}
              </span>
            </div>
            <div className="mt-2 text-[10px] text-slate-500 font-medium truncate">
              Ambang batas outlier: &lt; 0.00
            </div>
          </div>

          {/* Metrik 3: 5-Fold CV Accuracy */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-semibold">Akurasi 5-Fold CV</span>
              <Layers className="w-3.5 h-3.5 text-sky-600" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg sm:text-xl font-bold text-slate-900">
                {(ML_PRODUCTION_META.rf_cv5_accuracy_mean * 100).toFixed(1)}%
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                ± {(ML_PRODUCTION_META.rf_cv5_accuracy_std * 100).toFixed(2)}%
              </span>
            </div>
            <div className="mt-2 text-[10px] text-slate-500 font-medium truncate">
              F1-Macro Holdout: {(ML_PRODUCTION_META.rf_holdout_f1_macro * 100).toFixed(1)}%
            </div>
          </div>

          {/* Metrik 4: Efisiensi IoT Real-Time */}
          <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/70">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-[11px] font-semibold">Latensi Inferensi</span>
              <Zap className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg sm:text-xl font-bold text-emerald-700">
                &lt; 1.0 ms
              </span>
              <span className="text-[10px] text-slate-400 font-medium">
                di server Python
              </span>
            </div>
            <div className="mt-2 text-[10px] text-slate-500 font-medium truncate">
              Ukuran bundle: {ML_PRODUCTION_META.model_size_kb} KB
            </div>
          </div>
        </div>
      </div>

      {/* Grid 2 Kolom: Inspektor 8 Fitur Live & Visualisasi Feature Importance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Kolom Kiri: Inspektor 8 Fitur Live */}
        <div className="rounded-3xl bg-white/90 backdrop-blur-xl border border-slate-200/80 shadow-glass p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-600" />
              <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                Vektor Input 8 Fitur Real-Time
              </h4>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              8 Variabel Numerik
            </span>
          </div>

          <p className="text-[11px] text-slate-500">
            Data telemetri yang sedang dievaluasi oleh model Random Forest saat ini:
          </p>

          <div className="grid grid-cols-2 gap-2.5">
            {liveFeatures.map((feat) => (
              <div
                key={feat.key}
                className={`p-2.5 rounded-2xl border transition-all ${
                  feat.highlight
                    ? "bg-indigo-50/60 border-indigo-200/80"
                    : "bg-slate-50/80 border-slate-200/70"
                }`}
              >
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[11px] font-mono font-bold text-slate-700 truncate">
                    {feat.short}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400">
                    {feat.unit}
                  </span>
                </div>
                <div className="text-sm font-extrabold text-slate-900">
                  {feat.value}
                </div>
                <p className="text-[10px] text-slate-500 mt-1 truncate" title={feat.desc}>
                  {feat.desc}
                </p>
              </div>
            ))}
          </div>

          {/* Catatan Akademis Encoding Siklikal */}
          <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/70 text-[11px] text-slate-600 flex items-start gap-2">
            <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="text-slate-800">Catatan Waktu Trigonometri:</strong> Variabel <code>time_sin</code> dan <code>time_cos</code> menyelesaikan diskontinuitas pergantian hari (pukul 23:59 ke 00:01 tetap berdekatan secara kontinu pada lingkaran trigonometri).
            </p>
          </div>
        </div>

        {/* Kolom Kanan: Grafik Bobot Fitur (Feature Importance) */}
        <div className="rounded-3xl bg-white/90 backdrop-blur-xl border border-slate-200/80 shadow-glass p-5 space-y-3.5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-indigo-600" />
                <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                  Feature Importance (Kontribusi Keputusan)
                </h4>
              </div>
              <span className="text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-full">
                XAI Transparan
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Bobot pengaruh fitur yang dipelajari Random Forest dari dataset 5.000 sampel:
            </p>

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

          <div className="pt-3 border-t border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
            <span>Fitur paling dominan: Waktu & Suara</span>
            <span className="font-mono text-[10px] text-slate-400">
              100 Estimator Pohon
            </span>
          </div>
        </div>
      </div>

      {/* Tabel Komparasi Algoritma & Validasi Ilmiah untuk Presentasi */}
      <div className="rounded-3xl bg-white/90 backdrop-blur-xl border border-slate-200/80 shadow-glass p-5 sm:p-6 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
          <div>
            <h4 className="text-xs sm:text-sm font-bold text-slate-900">
              Komparasi Performa Algoritma Klasifikasi
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              Hasil pengujian 5-Fold Stratified Cross Validation dan Holdout Test Set (Dataset Sintetis Ber-noise 5.000 Sampel).
            </p>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">
            Materi Pertanggungjawaban Slide PPT
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200/80 text-[11px] text-slate-500 uppercase tracking-wider">
                <th className="py-2.5 px-3 font-bold">Algoritma</th>
                <th className="py-2.5 px-3 font-bold">Arsitektur</th>
                <th className="py-2.5 px-3 font-bold">5-Fold CV Acc</th>
                <th className="py-2.5 px-3 font-bold">Holdout F1</th>
                <th className="py-2.5 px-3 font-bold">Latensi</th>
                <th className="py-2.5 px-3 font-bold">Karakteristik & Alasan Pemilihan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ML_PRODUCTION_META.comparisons.map((model) => (
                <tr
                  key={model.key}
                  className={`transition-colors ${
                    model.is_production
                      ? "bg-indigo-50/50 font-medium"
                      : "hover:bg-slate-50/50"
                  }`}
                >
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900">{model.name}</span>
                      {model.is_production && (
                        <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-emerald-100 text-emerald-800">
                          PRODUKSI
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-slate-600 font-mono text-[11px]">
                    {model.type}
                  </td>
                  <td className="py-3 px-3 font-bold text-slate-900">
                    {(model.cv_acc_mean * 100).toFixed(1)}%
                    <span className="text-[10px] text-slate-400 font-normal ml-1">
                      (±{(model.cv_acc_std * 100).toFixed(2)}%)
                    </span>
                  </td>
                  <td className="py-3 px-3 font-bold text-indigo-700">
                    {(model.holdout_f1 * 100).toFixed(1)}%
                  </td>
                  <td className="py-3 px-3 text-slate-700 font-mono">
                    {model.latency_ms.toFixed(2)} ms
                  </td>
                  <td className="py-3 px-3 text-[11px] text-slate-600 max-w-xs">
                    {model.pros}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
