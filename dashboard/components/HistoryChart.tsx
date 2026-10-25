"use client";

import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { TelemetryHistoryPoint } from "@/lib/types";

interface HistoryChartProps {
  data: TelemetryHistoryPoint[];
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    payload: TelemetryHistoryPoint;
  }>;
  label?: string;
}

function CustomDarkTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;

  return (
    <div className="bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl border border-slate-800 text-xs min-w-[165px]">
      <p className="font-semibold text-slate-300 mb-2">
        Waktu: {label} ({point?.nearest_poi})
      </p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-1 h-3 rounded-full bg-sky-400" />
            Suara
          </span>
          <span className="font-bold text-white">{point?.db} dB</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-300">
            <span className="w-1 h-3 rounded-full bg-amber-400" />
            Jarak POI
          </span>
          <span className="font-bold text-white">{point?.distance_m} m</span>
        </div>
      </div>
    </div>
  );
}

export default function HistoryChart({ data }: HistoryChartProps) {
  return (
    <div className="p-5 rounded-3xl bg-white/80 backdrop-blur-xl border border-slate-200/80 shadow-glass">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">
            Grafik Suara & Jarak
          </h3>
          <p className="text-xs text-slate-400">
            Riwayat tingkat suara (dB) dan jarak ke titik terdekat (m)
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-medium text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500" />
            Suara (dB)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            Jarak (m)
          </span>
          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 font-semibold">
            Real-time
          </span>
        </div>
      </div>

      <div className="w-full h-[200px]">
        {data.length === 0 ? (
          <div className="w-full h-full rounded-2xl bg-slate-50/80 border border-dashed border-slate-200 flex items-center justify-center text-xs font-medium text-slate-400">
            Belum ada data telemetri masuk. Aktifkan sensor HP atau pilih skenario.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorDb" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="colorDist" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#F1F5F9"
              />
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#94A3B8", fontSize: 11 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#94A3B8", fontSize: 11 }}
              />
              <Tooltip content={<CustomDarkTooltip />} />
              <Area
                type="monotone"
                dataKey="db"
                name="Suara"
                stroke="#0EA5E9"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#colorDb)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="distance_m"
                name="Jarak"
                stroke="#F59E0B"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorDist)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
