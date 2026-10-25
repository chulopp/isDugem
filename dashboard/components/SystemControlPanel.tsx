"use client";

import React, { useState } from "react";
import {
  MapPin,
  Bell,
  AlertOctagon,
  Send,
  Cpu,
  Radio,
  Smartphone,
  Sliders,
} from "lucide-react";
import {
  Alert,
  AnakTelemetry,
  OrtuTelemetry,
  SystemEventLog,
} from "@/lib/types";
import { STATUS_DISPLAY } from "@/lib/mqttTopics";

interface SystemControlPanelProps {
  telemetry: AnakTelemetry;
  ortuTelemetry: OrtuTelemetry | null;
  alert: Alert;
  events: SystemEventLog[];
  onClearEvents?: () => void;
  onSendCommand: (
    type: "ping" | "reminder" | "alarm",
    customMessage?: string
  ) => void;
}

export default function SystemControlPanel({
  telemetry,
  ortuTelemetry,
  alert,
  events,
  onClearEvents,
  onSendCommand,
}: SystemControlPanelProps) {
  const [customMsg, setCustomMsg] = useState("");
  const [lastTriggered, setLastTriggered] = useState<string | null>(null);

  const statusMeta = STATUS_DISPLAY[alert.status] || STATUS_DISPLAY.NORMAL;

  const handleAction = (
    type: "ping" | "reminder" | "alarm",
    msg?: string
  ) => {
    onSendCommand(type, msg);
    setLastTriggered(type.toUpperCase());
    setTimeout(() => setLastTriggered(null), 2000);
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customMsg.trim();
    if (!trimmed) return;
    handleAction("reminder", trimmed);
    setCustomMsg("");
  };

  return (
    <aside className="w-full xl:w-[345px] shrink-0 flex flex-col justify-between p-6 border-t xl:border-t-0 xl:border-l border-slate-200/80 bg-white/75 backdrop-blur-xl">
      <div>
        {/* Kartu Atas: Panel Kontrol Sistem */}
        <div className="p-5 rounded-3xl bg-slate-100/85 border border-slate-200/80 text-center">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-200/80 text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-3">
            <Sliders className="w-3 h-3 text-slate-600" />
            <span>Panel Kontrol Sistem</span>
          </div>

          {/* Indikator Target Perangkat */}
          <div className="relative w-16 h-16 mx-auto mb-2.5 rounded-full bg-white border-2 border-white shadow-sm flex items-center justify-center">
            <Smartphone className="w-7 h-7 text-slate-800" />
            <span
              className={`absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${statusMeta.dotColor}`}
            />
          </div>

          <h2 className="text-sm font-bold text-slate-900">Perangkat Anak</h2>
          <p className="text-xs text-slate-500 font-mono mt-0.5">
            ID: {telemetry.device_id} · Paket #{telemetry.sequence}
          </p>

          {/* 3 Tombol Bulat Aksi Cepat */}
          <div className="flex items-center justify-center gap-3.5 mt-4">
            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => handleAction("ping")}
                title="Kirim Ping Lokasi"
                className="w-11 h-11 rounded-full bg-white hover:bg-slate-900 text-slate-700 hover:text-white border border-slate-200/90 shadow-sm flex items-center justify-center transition-all active:scale-95"
              >
                <MapPin className="w-4 h-4" />
              </button>
              <span className="text-[11px] font-semibold text-slate-600">
                Ping
              </span>
            </div>

            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => handleAction("reminder")}
                title="Kirim Pengingat"
                className="w-11 h-11 rounded-full bg-white hover:bg-amber-600 text-slate-700 hover:text-white border border-slate-200/90 shadow-sm flex items-center justify-center transition-all active:scale-95"
              >
                <Bell className="w-4 h-4" />
              </button>
              <span className="text-[11px] font-semibold text-slate-600">
                Ingatkan
              </span>
            </div>

            <div className="flex flex-col items-center gap-1">
              <button
                onClick={() => handleAction("alarm")}
                title="Bunyikan Alarm"
                className="w-11 h-11 rounded-full bg-white hover:bg-rose-600 text-rose-600 hover:text-white border border-slate-200/90 shadow-sm flex items-center justify-center transition-all active:scale-95"
              >
                <AlertOctagon className="w-4 h-4" />
              </button>
              <span className="text-[11px] font-semibold text-slate-600">
                Alarm
              </span>
            </div>
          </div>

          {lastTriggered && (
            <p className="mt-2.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl py-1 px-2">
              Perintah {lastTriggered} terkirim ke MQTT
            </p>
          )}

          {/* Status Perangkat Edge 2 (Ortu) */}
          <div className="mt-4 pt-3 border-t border-slate-200/80 flex items-center justify-between text-[11px] text-slate-600">
            <span className="flex items-center gap-1.5 font-medium">
              <Radio className="w-3.5 h-3.5 text-slate-500" />
              Edge Ortu (Shake)
            </span>
            <span className="font-semibold text-slate-800">
              {ortuTelemetry
                ? `Aktif (#${ortuTelemetry.sequence})`
                : "Siap Menerima"}
            </span>
          </div>
        </div>

        {/* Bagian Tengah: Riwayat Kejadian (Activity Feed) */}
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Riwayat Kejadian
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-slate-400">
                {events.length} catatan
              </span>
              {events.length > 0 && onClearEvents && (
                <button
                  onClick={onClearEvents}
                  className="text-[11px] font-semibold text-rose-600 hover:underline"
                >
                  Hapus
                </button>
              )}
            </div>
          </div>

          {events.length === 0 ? (
            <div className="p-5 rounded-2xl bg-slate-50/80 border border-dashed border-slate-200 text-center text-xs text-slate-400">
              Belum ada catatan kejadian.
            </div>
          ) : (
            <div className="space-y-3.5 max-h-[360px] overflow-y-auto pr-1">
              {events.map((ev) => {
                const bubbleStyle =
                  ev.severity === "critical"
                    ? "bg-rose-50/90 border-rose-200 text-rose-900"
                    : ev.severity === "warning"
                    ? "bg-amber-50/90 border-amber-200 text-amber-900"
                    : ev.severity === "normal"
                    ? "bg-sky-50/90 border-sky-200/80 text-slate-800"
                    : "bg-slate-100/90 border-slate-200/80 text-slate-700";

                return (
                  <div key={ev.id} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-6 h-6 rounded-full bg-slate-200/80 flex items-center justify-center shrink-0">
                          <Cpu className="w-3.5 h-3.5 text-slate-700" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {ev.sender}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-medium text-slate-400 shrink-0">
                        {ev.time}
                      </span>
                    </div>

                    <div
                      className={`ml-8 p-3 rounded-2xl border text-xs leading-relaxed ${bubbleStyle}`}
                    >
                      <p className="font-bold mb-0.5">{ev.title}</p>
                      <p>{ev.message}</p>
                      {ev.meta && (
                        <p className="text-[10px] opacity-75 mt-1 font-mono">
                          {ev.meta}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bagian Bawah: Input Pesan Perintah Kustom */}
      <form onSubmit={handleCustomSubmit} className="mt-5 pt-3">
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-slate-100/90 border border-slate-200/80 focus-within:bg-white focus-within:border-slate-400 transition-all">
          <input
            type="text"
            value={customMsg}
            onChange={(e) => setCustomMsg(e.target.value)}
            placeholder="Kirim pesan ke perangkat anak..."
            className="w-full bg-transparent text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="submit"
            title="Kirim Pesan"
            className="w-7 h-7 rounded-xl bg-slate-900 hover:bg-slate-700 text-white flex items-center justify-center shrink-0 transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </aside>
  );
}
