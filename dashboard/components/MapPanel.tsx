"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import {
  LocateFixed,
  MapPin,
  Navigation2,
  Play,
  Square,
  Compass,
} from "lucide-react";
import {
  Alert,
  AnakTelemetry,
  LiveTripRoute,
  PoiSpot,
} from "@/lib/types";
import {
  POI_SPOTS,
  computeDistancesToCategories,
} from "@/lib/mqttTopics";
import { LIVE_TRIP_ROUTES } from "@/lib/mockData";

const LeafletMapInner = dynamic(() => import("./LeafletMapInner"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-slate-100/80 text-xs font-medium text-slate-500">
      Memuat peta Semarang...
    </div>
  ),
});

interface MapPanelProps {
  telemetry: AnakTelemetry;
  alert: Alert;
  trailCoords: [number, number][];
  activeRouteCoords: [number, number][];
  isTripRunning: boolean;
  activeTripId: string | null;
  onStartLiveTrip: (route: LiveTripRoute) => void;
  onStopLiveTrip: () => void;
  onJumpToSpot: (spot: PoiSpot) => void;
  expanded?: boolean;
}

export default function MapPanel({
  telemetry,
  alert,
  trailCoords,
  activeRouteCoords,
  isTripRunning,
  activeTripId,
  onStartLiveTrip,
  onStopLiveTrip,
  onJumpToSpot,
  expanded = false,
}: MapPanelProps) {
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  const [cameraTarget, setCameraTarget] = useState<{
    lat: number;
    lon: number;
    zoom: number;
    ts: number;
  } | null>(null);

  const { nearestSpot, nearestSpotDist } = computeDistancesToCategories(
    telemetry.location.lat,
    telemetry.location.lon
  );

  const flyToRegion = (lat: number, lon: number, zoom: number) => {
    setAutoFollow(false);
    setCameraTarget({ lat, lon, zoom, ts: Date.now() });
  };

  return (
    <div className="rounded-3xl bg-white/85 backdrop-blur-xl border border-slate-200/80 shadow-glass overflow-hidden flex flex-col">
      {/* Header Panel Peta */}
      <div className="px-5 py-3.5 border-b border-slate-200/70 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-bold text-slate-900">
            Peta Pelacakan Live
          </h3>
        </div>

        {/* Tombol Fokus Kamera */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => flyToRegion(-7.0555, 110.4375, 14)}
            className="px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200/80 text-slate-700 transition-colors"
          >
            Area Tembalang
          </button>
          <button
            onClick={() => flyToRegion(-6.982, 110.435, 13)}
            className="px-2.5 py-1 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200/80 text-slate-700 transition-colors"
          >
            Area Semarang Bawah
          </button>
          <button
            onClick={() => {
              setAutoFollow((prev) => !prev);
              if (!autoFollow) {
                setCameraTarget({
                  lat: telemetry.location.lat,
                  lon: telemetry.location.lon,
                  zoom: 16,
                  ts: Date.now(),
                });
              }
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold transition-colors ${
              autoFollow
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200/80"
            }`}
          >
            <LocateFixed className="w-3.5 h-3.5" />
            <span>Ikuti Posisi</span>
          </button>
        </div>
      </div>

      {/* Area Peta Utama */}
      <div
        className={`relative w-full ${
          expanded ? "h-[520px]" : "h-[340px]"
        } bg-slate-100`}
      >
        <LeafletMapInner
          targetLat={telemetry.location.lat}
          targetLon={telemetry.location.lon}
          accuracyM={telemetry.location.accuracy_m}
          db={telemetry.audio.db}
          status={alert.status}
          nearestSpot={nearestSpot}
          nearestDistM={nearestSpotDist}
          trailCoords={trailCoords}
          activeRouteCoords={activeRouteCoords}
          isTripRunning={isTripRunning}
          autoFollow={autoFollow}
          cameraTarget={cameraTarget}
          onSelectSpot={(spot) => {
            onJumpToSpot(spot);
          }}
        />

        {/* Floating Liquid Glass Info Kiri Atas */}
        <div className="absolute top-3 left-3 z-[400] px-3.5 py-2.5 rounded-2xl bg-white/85 backdrop-blur-md border border-white/90 shadow-glass-pill pointer-events-none">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-slate-700" />
            <span className="text-xs font-bold text-slate-900">
              {nearestSpot.name}
            </span>
            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700">
              {Math.round(nearestSpotDist)} m
            </span>
          </div>
          <p className="text-[11px] font-mono text-slate-500 mt-0.5">
            GPS: {telemetry.location.lat.toFixed(5)},{" "}
            {telemetry.location.lon.toFixed(5)} (±
            {telemetry.location.accuracy_m.toFixed(0)}m)
          </p>
        </div>

        {/* Floating Legend Kanan Bawah */}
        <div className="absolute bottom-3 right-3 z-[400] px-3 py-1.5 rounded-xl bg-white/85 backdrop-blur-md border border-white/90 shadow-sm flex items-center gap-3 text-[11px] font-semibold text-slate-700">
          <span className="flex items-center gap-1">
            <span className="w-2 rounded-full bg-blue-600 h-2" /> Kampus
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 rounded-full bg-emerald-500 h-2" /> Masjid
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 rounded-full bg-indigo-500 h-2" /> Kos
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 rounded-full bg-rose-600 h-2" /> Bar
          </span>
        </div>
      </div>

      {/* Bar Bawah: Kontrol Simulasi Perjalanan Live & Pintasan Titik */}
      <div className="px-5 py-3 bg-slate-50/80 border-t border-slate-200/70 flex flex-col gap-2.5 min-h-[92px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
            <Navigation2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>Simulasi Jalan Live:</span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {LIVE_TRIP_ROUTES.map((route) => {
              const isThisActive = isTripRunning && activeTripId === route.id;
              return (
                <button
                  key={route.id}
                  onClick={() => {
                    if (isThisActive) {
                      onStopLiveTrip();
                    } else {
                      setAutoFollow(true);
                      onStartLiveTrip(route);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    isThisActive
                      ? "bg-emerald-600 text-white shadow-sm"
                      : "bg-white hover:bg-slate-100 text-slate-700 border border-slate-200/80"
                  }`}
                >
                  {isThisActive ? (
                    <Square className="w-3 h-3 fill-current" />
                  ) : (
                    <Play className="w-3 h-3 fill-current" />
                  )}
                  <span>
                    {route.fromName} ke {route.toName}
                  </span>
                </button>
              );
            })}

            {isTripRunning && (
              <button
                onClick={onStopLiveTrip}
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition-colors"
              >
                Berhenti
              </button>
            )}
          </div>
        </div>

        {/* Pintasan Titik Lokasi Spesifik */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          <span className="text-[11px] font-semibold text-slate-400 shrink-0 mr-1">
            Titik POI:
          </span>
          {POI_SPOTS.map((spot) => (
            <button
              key={spot.id}
              onClick={() => {
                setAutoFollow(true);
                setCameraTarget({
                  lat: spot.lat,
                  lon: spot.lon,
                  zoom: 16,
                  ts: Date.now(),
                });
                onJumpToSpot(spot);
              }}
              className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200/70 text-[11px] font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              <MapPin
                className="w-3 h-3"
                style={{ color: spot.color }}
              />
              <span>{spot.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
