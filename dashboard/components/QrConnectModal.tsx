"use client";

import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, Smartphone, Radio, ExternalLink } from "lucide-react";
import { PROJECT_ID } from "@/lib/mqttTopics";

interface QrConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QrConnectModal({
  isOpen,
  onClose,
}: QrConnectModalProps) {
  const [origin, setOrigin] = useState("https://isdugem.vercel.app");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  if (!isOpen) return null;

  const anakUrl = `${origin}/anak`;
  const ortuUrl = `${origin}/ortu`;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/35 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-3xl bg-white/95 backdrop-blur-xl border border-white shadow-2xl p-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Koneksi Perangkat HP (Edge Devices)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Pindai kode QR menggunakan kamera HP. Topik ID: {PROJECT_ID}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-5">
          {/* QR Edge Anak */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col items-center text-center">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-100 text-sky-800 text-xs font-bold mb-3">
              <Smartphone className="w-3.5 h-3.5" />
              <span>1. HP Anak (Sensor)</span>
            </div>
            <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm">
              <QRCodeSVG value={anakUrl} size={148} />
            </div>
            <p className="text-[11px] font-mono text-slate-500 mt-3 break-all">
              {anakUrl}
            </p>
            <a
              href={anakUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-slate-900 hover:underline"
            >
              <span>Buka di Tab Baru</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {/* QR Edge Ortu */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col items-center text-center">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold mb-3">
              <Radio className="w-3.5 h-3.5" />
              <span>2. HP Ortu (Shake)</span>
            </div>
            <div className="p-3 bg-white rounded-2xl border border-slate-200 shadow-sm">
              <QRCodeSVG value={ortuUrl} size={148} />
            </div>
            <p className="text-[11px] font-mono text-slate-500 mt-3 break-all">
              {ortuUrl}
            </p>
            <a
              href={ortuUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-slate-900 hover:underline"
            >
              <span>Buka di Tab Baru</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
