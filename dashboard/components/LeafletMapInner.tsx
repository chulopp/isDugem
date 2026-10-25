"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  Marker,
  Popup,
  Polyline,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MACRO_ZONES, POI_SPOTS } from "@/lib/mqttTopics";
import { AlertStatus, PoiSpot } from "@/lib/types";

interface LeafletMapInnerProps {
  targetLat: number;
  targetLon: number;
  accuracyM: number;
  db: number;
  status: AlertStatus;
  nearestSpot: PoiSpot;
  nearestDistM: number;
  trailCoords: [number, number][];
  activeRouteCoords: [number, number][];
  autoFollow: boolean;
  cameraTarget: { lat: number; lon: number; zoom: number; ts: number } | null;
  onSelectSpot?: (spot: PoiSpot) => void;
}

function MapCameraController({
  pos,
  autoFollow,
  cameraTarget,
}: {
  pos: [number, number];
  autoFollow: boolean;
  cameraTarget: { lat: number; lon: number; zoom: number; ts: number } | null;
}) {
  const map = useMap();
  const lastTargetTs = useRef<number>(0);

  useEffect(() => {
    const container = map.getContainer();
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      map.invalidateSize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);

  useEffect(() => {
    if (cameraTarget && cameraTarget.ts !== lastTargetTs.current) {
      lastTargetTs.current = cameraTarget.ts;
      map.flyTo([cameraTarget.lat, cameraTarget.lon], cameraTarget.zoom, {
        duration: 1.1,
      });
    }
  }, [cameraTarget, map]);

  useEffect(() => {
    if (autoFollow) {
      map.panTo(pos, { animate: true, duration: 0.4 });
    }
  }, [pos, autoFollow, map]);

  return null;
}

function createAnakIcon(status: AlertStatus, bearingDeg: number) {
  const isDanger =
    status === "ANOMALY_FAKE_GPS" || status === "CRITICAL_TERDETEKSI_DI_BAR";
  const isWarn =
    status === "ALERT_BOLOS_KULIAH" || status === "WARNING_BELUM_KE_MASJID";

  const mainColor = isDanger ? "#E11D48" : isWarn ? "#D97706" : "#059669";
  const ringColor = isDanger
    ? "rgba(225, 29, 72, 0.28)"
    : isWarn
    ? "rgba(217, 119, 6, 0.25)"
    : "rgba(5, 150, 105, 0.25)";

  const html = `
    <div style="position:relative;width:44px;height:44px;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;width:42px;height:42px;border-radius:9999px;background:${ringColor};animation:ping 1.8s cubic-bezier(0,0,0.2,1) infinite;"></div>
      <div style="position:relative;width:30px;height:30px;border-radius:9999px;background:${mainColor};border:3px solid #ffffff;box-shadow:0 4px 12px rgba(15,23,42,0.28);display:flex;align-items:center;justify-content:center;transform:rotate(${bearingDeg}deg);transition:transform 0.2s ease;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 19 21 12 17 5 21 12 2"></polygon>
        </svg>
      </div>
    </div>
  `;

  return L.divIcon({
    className: "custom-anak-marker",
    html,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  });
}

function createPoiIcon(spot: PoiSpot) {
  const labelBg = spot.color;
  const shortTag =
    spot.category === "kampus"
      ? "KAMPUS"
      : spot.category === "masjid"
      ? "MASJID"
      : spot.category === "kos"
      ? "KOS"
      : "BAR";

  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-6px);">
      <div style="padding:2px 7px;border-radius:9999px;background:#ffffff;border:1.5px solid ${labelBg};color:#0f172a;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(15,23,42,0.12);">
        <span style="color:${labelBg};margin-right:3px;">●</span>${spot.name}
      </div>
      <div style="width:10px;height:10px;border-radius:9999px;background:${labelBg};border:2px solid #ffffff;margin-top:2px;box-shadow:0 2px 4px rgba(0,0,0,0.2);" title="${shortTag}"></div>
    </div>
  `;

  return L.divIcon({
    className: "custom-poi-marker",
    html,
    iconSize: [120, 34],
    iconAnchor: [60, 26],
  });
}

export default function LeafletMapInner({
  targetLat,
  targetLon,
  accuracyM,
  db,
  status,
  nearestSpot,
  nearestDistM,
  trailCoords,
  activeRouteCoords,
  autoFollow,
  cameraTarget,
  onSelectSpot,
}: LeafletMapInnerProps) {
  const [renderedPos, setRenderedPos] = useState<[number, number]>([
    targetLat,
    targetLon,
  ]);
  const [bearing, setBearing] = useState<number>(0);

  const animFrameRef = useRef<number | null>(null);
  const currentPosRef = useRef<[number, number]>([targetLat, targetLon]);

  useEffect(() => {
    const startPos = currentPosRef.current;
    const endPos: [number, number] = [targetLat, targetLon];

    const dLat = endPos[0] - startPos[0];
    const dLon = endPos[1] - startPos[1];

    if (Math.abs(dLat) < 0.000001 && Math.abs(dLon) < 0.000001) {
      return;
    }

    const angleRad = Math.atan2(dLon, dLat);
    const angleDeg = Math.round((angleRad * 180) / Math.PI);
    setBearing(angleDeg);

    const durationMs = 550;
    const startTime = performance.now();

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }

    const step = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const ease = 1 - Math.pow(1 - t, 3);

      const nextLat = startPos[0] + dLat * ease;
      const nextLon = startPos[1] + dLon * ease;

      currentPosRef.current = [nextLat, nextLon];
      setRenderedPos([nextLat, nextLon]);

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      }
    };

    animFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [targetLat, targetLon]);

  const anakIcon = createAnakIcon(status, bearing);

  return (
    <MapContainer
      center={[-7.053, 110.438]}
      zoom={15}
      scrollWheelZoom={true}
      zoomControl={false}
      className="w-full h-full z-0"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <MapCameraController
        pos={renderedPos}
        autoFollow={autoFollow}
        cameraTarget={cameraTarget}
      />

      {/* Lingkaran Cluster Zona Kos & Kota Lama */}
      {MACRO_ZONES.map((zone) => (
        <Circle
          key={zone.id}
          center={[zone.lat, zone.lon]}
          radius={zone.radius_m}
          pathOptions={{
            color: zone.color,
            weight: 1,
            dashArray: "6 6",
            fillColor: zone.color,
            fillOpacity: 0.04,
          }}
        />
      ))}

      {/* Lingkaran Geofence & Marker Tiap Titik POI */}
      {POI_SPOTS.map((spot) => (
        <React.Fragment key={spot.id}>
          <Circle
            center={[spot.lat, spot.lon]}
            radius={spot.radius_m}
            pathOptions={{
              color: spot.color,
              weight: 2,
              fillColor: spot.color,
              fillOpacity: 0.14,
            }}
          />
          <Marker
            position={[spot.lat, spot.lon]}
            icon={createPoiIcon(spot)}
            eventHandlers={{
              click: () => onSelectSpot?.(spot),
            }}
          >
            <Popup>
              <div className="text-xs space-y-1 p-0.5">
                <p className="font-bold text-slate-900">{spot.name}</p>
                <p className="text-slate-500">
                  Area: {spot.area} | Radius: {spot.radius_m} m
                </p>
                <p className="font-mono text-[11px] text-slate-600">
                  {spot.lat.toFixed(4)}, {spot.lon.toFixed(4)}
                </p>
              </div>
            </Popup>
          </Marker>
        </React.Fragment>
      ))}

      {/* Rute Jalan Aktif (Gojek Live Route) */}
      {activeRouteCoords.length > 1 && (
        <Polyline
          positions={activeRouteCoords}
          pathOptions={{
            color: "#059669",
            weight: 5,
            opacity: 0.85,
            lineCap: "round",
            lineJoin: "round",
          }}
        />
      )}

      {/* Jejak Perjalanan (Trail) */}
      {trailCoords.length > 1 && (
        <Polyline
          positions={trailCoords}
          pathOptions={{
            color: "#2563EB",
            weight: 3,
            opacity: 0.65,
            dashArray: "4 6",
          }}
        />
      )}

      {/* Garis Jarak ke POI Terdekat */}
      <Polyline
        positions={[renderedPos, [nearestSpot.lat, nearestSpot.lon]]}
        pathOptions={{
          color: nearestSpot.color,
          weight: 2,
          dashArray: "5 5",
          opacity: 0.75,
        }}
      />

      {/* Lingkaran Akurasi GPS Anak */}
      <Circle
        center={renderedPos}
        radius={Math.max(12, Math.min(accuracyM, 60))}
        pathOptions={{
          color: "#0284C7",
          weight: 1,
          fillColor: "#38BDF8",
          fillOpacity: 0.12,
        }}
      />

      {/* Marker Live Perangkat Anak */}
      <Marker position={renderedPos} icon={anakIcon}>
        <Popup>
          <div className="text-xs space-y-1">
            <p className="font-bold text-slate-900">Perangkat Anak</p>
            <p className="text-slate-600">
              Terdekat: {nearestSpot.name} ({Math.round(nearestDistM)} m)
            </p>
            <p className="text-slate-600">Suara: {db.toFixed(1)} dB</p>
            <p className="font-mono text-[11px] text-slate-500">
              {renderedPos[0].toFixed(5)}, {renderedPos[1].toFixed(5)}
            </p>
          </div>
        </Popup>
      </Marker>
    </MapContainer>
  );
}
