"use client";

import React from "react";
import Link from "next/link";
import {
  LayoutGrid,
  MapPin,
  Activity,
  PlayCircle,
  QrCode,
  Smartphone,
  Radio,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { PROJECT_ID } from "@/lib/mqttTopics";

export type NavTab = "overview" | "map" | "analytics" | "simulator";

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  onOpenQrModal: () => void;
  isMqttConnected: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function Sidebar({
  activeTab,
  onSelectTab,
  onOpenQrModal,
  isMqttConnected,
  isCollapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  const navItems: {
    id: NavTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: "overview", label: "Utama", icon: LayoutGrid },
    { id: "map", label: "Peta Live", icon: MapPin },
    { id: "analytics", label: "Grafik Data", icon: Activity },
    { id: "simulator", label: "Simulasi", icon: PlayCircle },
  ];

  return (
    <aside
      className={`w-full shrink-0 flex flex-col justify-between py-6 px-3.5 border-b lg:border-b-0 lg:border-r border-slate-200/80 bg-white/80 backdrop-blur-xl select-none overflow-hidden transition-[width] duration-300 ease-in-out ${
        isCollapsed ? "lg:w-[76px]" : "lg:w-[240px]"
      }`}
    >
      <div className="w-full">
        {/* Baris Header Atas: Tinggi Tetap (h-11) Agar Posisi Menu Tidak Bergeser */}
        <div className="h-11 mb-6 flex items-center justify-between px-1">
          <div
            className={`flex items-center overflow-hidden transition-all duration-300 ease-in-out ${
              isCollapsed ? "w-0 opacity-0" : "w-[148px] opacity-100"
            }`}
          >
            <img
              src="/logo.png"
              alt="ISDUGEM?!"
              className="h-8 w-auto max-w-[140px] object-contain shrink-0"
            />
          </div>

          <button
            onClick={onToggleCollapse}
            title={isCollapsed ? "Buka Sidebar" : "Tutup Sidebar"}
            className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200/80 text-slate-700 flex items-center justify-center shrink-0 transition-colors mx-auto lg:mx-0"
          >
            {isCollapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Menu Navigasi: Tinggi Tombol (h-11) dan Posisi Ikon (px-3.5) Tetap Sejajar */}
        <nav className="space-y-1.5 w-full">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                title={item.label}
                className={`w-full h-11 px-3.5 rounded-2xl flex items-center text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
                }`}
              >
                <span className="w-5 h-5 flex items-center justify-center shrink-0">
                  <Icon
                    className={`w-4 h-4 ${
                      isActive ? "text-white" : "text-slate-400"
                    }`}
                  />
                </span>
                <span
                  className={`whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out ${
                    isCollapsed
                      ? "max-w-0 opacity-0 ml-0"
                      : "max-w-[140px] opacity-100 ml-3"
                  }`}
                >
                  {item.label}
                </span>
              </button>
            );
          })}

          <button
            onClick={onOpenQrModal}
            title="Kode QR HP"
            className="w-full h-11 px-3.5 rounded-2xl flex items-center text-sm font-medium text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 transition-colors"
          >
            <span className="w-5 h-5 flex items-center justify-center shrink-0">
              <QrCode className="w-4 h-4 text-slate-400" />
            </span>
            <span
              className={`flex-1 flex items-center justify-between whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out ${
                isCollapsed
                  ? "max-w-0 opacity-0 ml-0"
                  : "max-w-[150px] opacity-100 ml-3"
              }`}
            >
              <span>Kode QR HP</span>
            </span>
          </button>
        </nav>
      </div>

      {/* Bagian Bawah: Status Broker & Pintasan Halaman Edge */}
      <div className="mt-6 pt-4 border-t border-slate-200/70 space-y-2 w-full">
        {/* Baris Status Broker */}
        <div
          title={`Broker MQTT: ${
            isMqttConnected ? "Terhubung" : "Menunggu"
          } (${PROJECT_ID})`}
          className="w-full h-11 px-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center overflow-hidden"
        >
          <span className="w-5 h-5 flex items-center justify-center shrink-0">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isMqttConnected
                  ? "bg-emerald-500 animate-pulse"
                  : "bg-amber-500"
              }`}
            />
          </span>
          <div
            className={`min-w-0 whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out ${
              isCollapsed
                ? "max-w-0 opacity-0 ml-0"
                : "max-w-[150px] opacity-100 ml-3"
            }`}
          >
            <p className="text-xs font-bold text-slate-800 leading-tight">
              Broker {isMqttConnected ? "Aktif" : "Lokal"}
            </p>
          </div>
        </div>

        {/* Pintasan Halaman Anak */}
        <Link
          href="/anak"
          target="_blank"
          title="Buka Halaman Anak"
          className="w-full h-10 px-3.5 rounded-2xl flex items-center text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100/80 transition-colors"
        >
          <span className="w-5 h-5 flex items-center justify-center shrink-0">
            <Smartphone className="w-4 h-4 text-slate-400" />
          </span>
          <span
            className={`whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out ${
              isCollapsed
                ? "max-w-0 opacity-0 ml-0"
                : "max-w-[150px] opacity-100 ml-3"
            }`}
          >
            Halaman Anak
          </span>
        </Link>

        {/* Pintasan Halaman Ortu */}
        <Link
          href="/ortu"
          target="_blank"
          title="Buka Halaman Ortu"
          className="w-full h-10 px-3.5 rounded-2xl flex items-center text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100/80 transition-colors"
        >
          <span className="w-5 h-5 flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4 text-slate-400" />
          </span>
          <span
            className={`whitespace-nowrap overflow-hidden transition-all duration-200 ease-in-out ${
              isCollapsed
                ? "max-w-0 opacity-0 ml-0"
                : "max-w-[150px] opacity-100 ml-3"
            }`}
          >
            Halaman Ortu
          </span>
        </Link>
      </div>
    </aside>
  );
}
