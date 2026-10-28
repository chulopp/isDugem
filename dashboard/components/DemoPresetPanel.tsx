"use client";

import React from "react";
import {
  GraduationCap,
  AlertTriangle,
  Moon,
  Flame,
  ShieldAlert,
  Play,
  Volume2,
} from "lucide-react";
import { DemoPreset } from "@/lib/types";
import { DEMO_PRESETS } from "@/lib/mockData";
import { STATUS_DISPLAY } from "@/lib/mqttTopics";

interface DemoPresetPanelProps {
  activePresetId: string | null;
  onApplyPreset: (preset: DemoPreset) => void;
}

export default function DemoPresetPanel({
  activePresetId,
  onApplyPreset,
}: DemoPresetPanelProps) {
  const getPresetIcon = (id: string) => {
    if (id.includes("kuliah")) {
      return {
        icon: GraduationCap,
        bg: "bg-sky-50 text-sky-700 border-sky-200",
      };
    }
    if (id.includes("bolos") || id.includes("sholat")) {
      return {
        icon: AlertTriangle,
        bg: "bg-amber-50 text-amber-700 border-amber-200",
      };
    }
    if (id.includes("kos")) {
      return {
        icon: Moon,
        bg: "bg-indigo-50 text-indigo-700 border-indigo-200",
      };
    }
    if (id.includes("fake")) {
      return {
        icon: ShieldAlert,
        bg: "bg-rose-100 text-rose-800 border-rose-300",
      };
    }
    return {
      icon: Flame,
      bg: "bg-rose-50 text-rose-700 border-rose-200",
    };
  };

  return (
    <div className="p-5 rounded-3xl bg-white/80 backdrop-blur-xl border border-slate-200/80 shadow-glass">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-slate-900">
            Skenario Pengujian
          </h3>
          <span className="text-xs font-medium text-slate-400 border-l border-slate-200 pl-3">
            {DEMO_PRESETS.length} skenario siap pakai
          </span>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold">
          Mode Demo
        </span>
      </div>

      <div className="divide-y divide-slate-100">
        {DEMO_PRESETS.map((preset) => {
          const { icon: Icon, bg } = getPresetIcon(preset.id);
          const statusMeta = STATUS_DISPLAY[preset.expected_status];
          const isSelected = activePresetId === preset.id;

          return (
            <div
              key={preset.id}
              className={`py-3 px-2.5 -mx-2.5 rounded-2xl flex items-center justify-between gap-3 transition-colors ${
                isSelected ? "bg-slate-100/80" : "hover:bg-slate-50/80"
              }`}
            >
              {/* Kiri: Ikon Bulat & Judul */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div
                  className={`w-9 h-9 rounded-full border flex items-center justify-center shrink-0 ${bg}`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-900 truncate">
                    {preset.title}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {preset.location_name} · {preset.time_display}
                  </p>
                </div>
              </div>

              {/* Tengah: Indikator Status & dB */}
              <div className="hidden sm:flex items-center gap-4 shrink-0">
                <div className="flex items-center text-xs font-semibold text-slate-700 w-24">
                  <span className="truncate">{statusMeta.shortLabel}</span>
                </div>

                <div className="flex items-center gap-1 text-xs font-bold text-slate-800 w-16">
                  <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>{preset.db} dB</span>
                </div>
              </div>

              {/* Kanan: Tombol Terapkan */}
              <button
                onClick={() => onApplyPreset(preset)}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  isSelected
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 hover:bg-slate-900 text-slate-700 hover:text-white"
                }`}
              >
                <Play className="w-3 h-3 fill-current" />
                <span>{isSelected ? "Aktif" : "Terapkan"}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
