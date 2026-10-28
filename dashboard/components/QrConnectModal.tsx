"use client";

import React, { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, Smartphone, Radio, ExternalLink } from "lucide-react";

interface QrConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QrConnectModal({
  isOpen,
  onClose,
}: QrConnectModalProps) {
  const [origin, setOrigin] = useState("https://isdugem.vercel.app");
  const [activeMobileTab, setActiveMobileTab] = useState<"anak" | "ortu">("anak");

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
    }
  }, []);

  if (!isOpen) return null;

  const anakUrl = `${origin}/anak`;
  const ortuUrl = `${origin}/ortu`;

  return (
    <div className="fixed inset-0 z-[1000] overflow-y-auto bg-slate-950/50 backdrop-blur-sm p-3.5 sm:p-4 flex items-center justify-center">
      {/* Klik backdrop untuk menutup modal */}
      <div className="fixed inset-0" onClick={onClose} aria-hidden="true" />

      {/* Kotak Modal */}
      <div className="relative w-full max-w-xl max-h-[92vh] flex flex-col rounded-3xl bg-white/95 backdrop-blur-xl border border-slate-200/80 shadow-2xl overflow-hidden my-auto select-none">
        {/* Header Modal (Shrink-0 agar tidak pernah terpotong) */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              Koneksi Perangkat HP
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Pindai kode QR menggunakan kamera HP untuk membuka antarmuka perangkat.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors shrink-0 ml-3"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Isi Modal: Scrollable jika layar pendek */}
        <div className="p-5 sm:p-6 overflow-y-auto">
          {/* Segmented Control Tab Khusus Layar Ponsel (< sm) */}
          <div className="sm:hidden flex p-1 bg-slate-100 rounded-2xl mb-4 border border-slate-200/70">
            <button
              type="button"
              onClick={() => setActiveMobileTab("anak")}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                activeMobileTab === "anak"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 text-sky-600" />
              <span>1. HP Anak</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveMobileTab("ortu")}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                activeMobileTab === "ortu"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Radio className="w-3.5 h-3.5 text-emerald-600" />
              <span>2. HP Ortu</span>
            </button>
          </div>

          {/* Grid Kartu QR */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Kartu HP Anak */}
            <div
              className={`p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col items-center text-center ${
                activeMobileTab === "anak" ? "flex" : "hidden sm:flex"
              }`}
            >
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-100 text-sky-800 text-xs font-bold mb-3">
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
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-100 hover:text-slate-900 transition-colors shadow-xs"
              >
                <span>Buka di Tab Baru</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
              </a>
            </div>

            {/* Kartu HP Ortu */}
            <div
              className={`p-4 rounded-2xl bg-slate-50 border border-slate-200/80 flex flex-col items-center text-center ${
                activeMobileTab === "ortu" ? "flex" : "hidden sm:flex"
              }`}
            >
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold mb-3">
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
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-100 hover:text-slate-900 transition-colors shadow-xs"
              >
                <span>Buka di Tab Baru</span>
                <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
              </a>
            </div>
          </div>
        </div>

        {/* Footer Modal (Shrink-0) */}
        <div className="px-5 sm:px-6 py-3 border-t border-slate-100 flex justify-end shrink-0 bg-slate-50/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
