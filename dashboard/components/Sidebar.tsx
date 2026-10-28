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
  X,
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
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export default function Sidebar({
  activeTab,
  onSelectTab,
  onOpenQrModal,
  isMqttConnected,
  isCollapsed = false,
  onToggleCollapse,
  isMobileOpen = false,
  onCloseMobile,
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
    <>
      {/* 1. Desktop Aside (Tampil hanya di layar lg ke atas) */}
      <aside
        className={`hidden lg:flex shrink-0 flex-col justify-between py-6 px-3.5 border-r border-slate-200/80 bg-white/80 backdrop-blur-xl select-none overflow-hidden transition-[width] duration-300 ease-in-out ${
          isCollapsed ? "lg:w-[76px]" : "lg:w-[240px]"
        }`}
      >
        <div className="w-full">
          {/* Baris Header Atas: Tinggi Tetap (h-11) */}
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

          {/* Menu Navigasi Desktop */}
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

        {/* Bagian Bawah Desktop: Status Broker & Pintasan Edge */}
        <div className="mt-6 pt-4 border-t border-slate-200/70 space-y-2 w-full">
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

      {/* 2. Mobile Off-Canvas Drawer (Tampil hanya di layar < lg) */}
      <div className="lg:hidden">
        {/* Backdrop Overlay Gelap Transparan */}
        <div
          onClick={onCloseMobile}
          className={`fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-50 transition-opacity duration-300 ${
            isMobileOpen
              ? "opacity-100 pointer-events-auto"
              : "opacity-0 pointer-events-none"
          }`}
          aria-hidden="true"
        />

        {/* Drawer Panel Samping (Slide In / Slide Out) */}
        <div
          className={`fixed inset-y-0 left-0 w-[280px] max-w-[85vw] bg-white z-50 shadow-2xl flex flex-col justify-between py-6 px-4 transition-transform duration-300 ease-in-out select-none ${
            isMobileOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="w-full">
            {/* Header Drawer: Logo & Tombol Tutup (X) */}
            <div className="h-11 mb-6 flex items-center justify-between px-1 border-b border-slate-100 pb-3">
              <img
                src="/logo.png"
                alt="ISDUGEM?!"
                className="h-8 w-auto max-w-[140px] object-contain shrink-0"
              />
              <button
                type="button"
                onClick={onCloseMobile}
                title="Tutup Menu"
                className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center shrink-0 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Menu Navigasi Mobile Lengkap */}
            <nav className="space-y-1.5 w-full">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelectTab(item.id);
                      onCloseMobile?.();
                    }}
                    title={item.label}
                    className={`w-full h-11 px-3.5 rounded-2xl flex items-center text-sm font-semibold transition-colors ${
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
                    <span className="ml-3 truncate">{item.label}</span>
                  </button>
                );
              })}

              <button
                onClick={() => {
                  onOpenQrModal();
                  onCloseMobile?.();
                }}
                title="Kode QR HP"
                className="w-full h-11 px-3.5 rounded-2xl flex items-center text-sm font-semibold text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 transition-colors"
              >
                <span className="w-5 h-5 flex items-center justify-center shrink-0">
                  <QrCode className="w-4 h-4 text-slate-400" />
                </span>
                <span className="ml-3 truncate">Kode QR HP</span>
              </button>
            </nav>
          </div>

          {/* Bagian Bawah Drawer: Status Broker & Pintasan Edge */}
          <div className="mt-6 pt-4 border-t border-slate-200/70 space-y-2 w-full">
            <div
              title={`Broker MQTT: ${
                isMqttConnected ? "Terhubung" : "Menunggu"
              } (${PROJECT_ID})`}
              className="w-full h-11 px-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 flex items-center"
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
              <p className="ml-3 text-xs font-bold text-slate-800 truncate">
                Broker {isMqttConnected ? "Aktif" : "Lokal"}
              </p>
            </div>

            <Link
              href="/anak"
              target="_blank"
              onClick={onCloseMobile}
              title="Buka Halaman Anak"
              className="w-full h-10 px-3.5 rounded-2xl flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <span className="w-5 h-5 flex items-center justify-center shrink-0">
                <Smartphone className="w-4 h-4 text-slate-400" />
              </span>
              <span className="ml-3 truncate">Halaman Anak</span>
            </Link>

            <Link
              href="/ortu"
              target="_blank"
              onClick={onCloseMobile}
              title="Buka Halaman Ortu"
              className="w-full h-10 px-3.5 rounded-2xl flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <span className="w-5 h-5 flex items-center justify-center shrink-0">
                <Radio className="w-4 h-4 text-slate-400" />
              </span>
              <span className="ml-3 truncate">Halaman Ortu</span>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
