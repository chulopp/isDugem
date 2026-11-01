"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Database,
  Play,
  Square,
  Download,
  Copy,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Smartphone,
  Tag,
  FileText,
} from "lucide-react";
import {
  buildFile,
  buildSample,
  checkConsistency,
  computePoiCategorySummary,
  deriveTimeLabelFromLocalTime,
  formatJakartaLocalTime,
  LABELS,
  LabelEnum,
  LabelType,
  resolveEffectiveSpeedMps,
  resolveTelemetryTimestampMs,
  Sample,
  SensorSnapshotInput,
  SERVER_POI,
  toFilename,
} from "@/lib/fieldRecorder";
import { POI_SPOTS } from "@/lib/mqttTopics";

const STORAGE_KEY_SAMPLES = "isdugem_field_samples_v1";
const STORAGE_KEY_DEVICE = "isdugem_field_device_v1";
const STORAGE_KEY_CUSTOM_DEVICE = "isdugem_field_custom_device_v1";
const MAX_STORED_SAMPLES = 2000;

const PRESET_DEVICES = [
  "Realme 9 Pro",
  "Poco X5 Pro 5G",
  "Realme 9 Pro Plus",
  "Lainnya",
] as const;

export interface FieldRecorderLiveSource {
  sensorActive: boolean;
  sessionStartMs: number | null;
  lastGpsFixReceivedMs: number | null;
  getSnapshot: () => SensorSnapshotInput;
}

interface FieldRecorderProps {
  liveSource: FieldRecorderLiveSource;
}

interface LivePreviewState {
  snapshot: SensorSnapshotInput;
  localTime: string;
  derivedTimeLabel: string;
  sensorElapsedS: number;
  gpsFixAgeS: number | null;
}

export default function FieldRecorder({ liveSource }: FieldRecorderProps) {
  const [selectedDeviceOption, setSelectedDeviceOption] =
    useState<string>("Realme 9 Pro");
  const [customDeviceName, setCustomDeviceName] = useState<string>("");

  const [selectedLabel, setSelectedLabel] =
    useState<LabelEnum>("SEDANG_KULIAH");
  const [labelType, setLabelType] = useState<LabelType>("real");
  const [note, setNote] = useState<string>("");
  const [batchSize, setBatchSize] = useState<5 | 10 | 20>(10);

  const [samples, setSamples] = useState<Sample[]>([]);
  const [storageNotice, setStorageNotice] = useState<{
    type: "info" | "warning" | "error";
    text: string;
  } | null>(null);

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordedInBatch, setRecordedInBatch] = useState<number>(0);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);

  const [livePreview, setLivePreview] = useState<LivePreviewState>(() => {
    const snap = liveSource.getSnapshot();
    const ts = resolveTelemetryTimestampMs(snap.timeMode, snap.seq, snap.nowMs);
    const lt = formatJakartaLocalTime(ts);
    return {
      snapshot: snap,
      localTime: lt,
      derivedTimeLabel: deriveTimeLabelFromLocalTime(lt),
      sensorElapsedS: 0,
      gpsFixAgeS: null,
    };
  });

  const recordTimerRef = useRef<NodeJS.Timeout | null>(null);
  const liveSourceRef = useRef<FieldRecorderLiveSource>(liveSource);
  useEffect(() => {
    liveSourceRef.current = liveSource;
  }, [liveSource]);

  const effectiveDeviceName =
    selectedDeviceOption === "Lainnya"
      ? customDeviceName.trim() || "HP Lainnya"
      : selectedDeviceOption;

  // Muat preferensi perangkat & sampel dari localStorage saat mount
  useEffect(() => {
    try {
      const savedDev = localStorage.getItem(STORAGE_KEY_DEVICE);
      if (savedDev) {
        setSelectedDeviceOption(savedDev);
      }
      const savedCustom = localStorage.getItem(STORAGE_KEY_CUSTOM_DEVICE);
      if (savedCustom) {
        setCustomDeviceName(savedCustom);
      }
      const rawSamples = localStorage.getItem(STORAGE_KEY_SAMPLES);
      if (rawSamples) {
        const parsed = JSON.parse(rawSamples);
        if (Array.isArray(parsed)) {
          setSamples(parsed.slice(0, MAX_STORED_SAMPLES));
        }
      }
    } catch {
      setStorageNotice({
        type: "warning",
        text: "Gagal membaca data rekaman dari localStorage.",
      });
    }
  }, []);

  // Simpan pilihan perangkat ke localStorage
  const handleSelectDevice = (val: string) => {
    setSelectedDeviceOption(val);
    try {
      localStorage.setItem(STORAGE_KEY_DEVICE, val);
    } catch {
      // Ignore storage error
    }
  };

  const handleCustomDeviceChange = (val: string) => {
    setCustomDeviceName(val);
    try {
      localStorage.setItem(STORAGE_KEY_CUSTOM_DEVICE, val);
    } catch {
      // Ignore storage error
    }
  };

  const persistSamples = useCallback((nextSamples: Sample[]) => {
    const capped =
      nextSamples.length > MAX_STORED_SAMPLES
        ? nextSamples.slice(nextSamples.length - MAX_STORED_SAMPLES)
        : nextSamples;
    setSamples(capped);
    try {
      localStorage.setItem(STORAGE_KEY_SAMPLES, JSON.stringify(capped));
      if (nextSamples.length > MAX_STORED_SAMPLES) {
        setStorageNotice({
          type: "warning",
          text: `Batas maksimum ${MAX_STORED_SAMPLES} sampel tercapai. Sampel terlama dipangkas.`,
        });
      }
    } catch {
      setStorageNotice({
        type: "error",
        text: "Kuota localStorage penuh! Segera unduh atau salin JSON lalu hapus sebagian data.",
      });
    }
  }, []);

  // Refresh ringkasan live tiap 1 detik dari snapshot ref (bukan setState di setiap tick sensor)
  useEffect(() => {
    const updatePreview = () => {
      const src = liveSourceRef.current;
      const snap = src.getSnapshot();
      const nowMs = Date.now();
      const ts = resolveTelemetryTimestampMs(snap.timeMode, snap.seq, nowMs);
      const lt = formatJakartaLocalTime(ts);
      const sensorElapsedS =
        src.sensorActive && src.sessionStartMs !== null
          ? Math.max(0, Math.floor((nowMs - src.sessionStartMs) / 1000))
          : 0;
      const gpsFixAgeS =
        src.lastGpsFixReceivedMs !== null
          ? Number(((nowMs - src.lastGpsFixReceivedMs) / 1000).toFixed(1))
          : null;

      setLivePreview({
        snapshot: snap,
        localTime: lt,
        derivedTimeLabel: deriveTimeLabelFromLocalTime(lt),
        sensorElapsedS,
        gpsFixAgeS,
      });
    };

    updatePreview();
    const id = setInterval(updatePreview, 1000);
    return () => clearInterval(id);
  }, []);

  const stopRecordingBatch = useCallback(() => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    setIsRecording(false);
  }, []);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
      }
    };
  }, []);

  // Evaluasi syarat pemblokiran tombol Rekam
  const isLockedCoord = livePreview.snapshot.lockedSpotId !== "gps_asli";
  const effectiveLabelType: LabelType = isLockedCoord ? "simulated" : labelType;
  const blockReasons: string[] = [];
  if (!liveSource.sensorActive) {
    blockReasons.push(
      "Sensor belum dimulai. Tekan tombol 'Mulai Sensor & Telemetri' di atas terlebih dahulu."
    );
  } else {
    if (livePreview.sensorElapsedS < 20) {
      blockReasons.push(
        `Warm-up estimator kecepatan: tunggu ${
          20 - livePreview.sensorElapsedS
        } detik lagi (sensor baru berjalan ${livePreview.sensorElapsedS}/20 dtk).`
      );
    }
    if (!isLockedCoord) {
      if (livePreview.gpsFixAgeS === null || livePreview.gpsFixAgeS > 5) {
        blockReasons.push(
          `Fix GPS terakhir terlalu tua (${
            livePreview.gpsFixAgeS !== null
              ? `${livePreview.gpsFixAgeS.toFixed(1)} dtk`
              : "belum ada fix"
          } > 5 dtk). Pastikan GPS HP aktif di ruang terbuka.`
        );
      }
      if (livePreview.snapshot.accuracy_m > 30) {
        blockReasons.push(
          `Akurasi GPS belum memadai (±${livePreview.snapshot.accuracy_m.toFixed(
            1
          )} m > 30 m). Tunggu sinyal GPS lebih akurat.`
        );
      }
    }
  }

  const canStartRecording = blockReasons.length === 0 && !isRecording;

  const startRecordingBatch = () => {
    if (!canStartRecording) return;

    setStorageNotice(null);
    setConfirmClear(false);
    setIsRecording(true);
    setRecordedInBatch(0);

    let count = 0;
    const target = batchSize;
    const captureOne = () => {
      const src = liveSourceRef.current;
      if (!src.sensorActive) {
        stopRecordingBatch();
        setStorageNotice({
          type: "warning",
          text: "Perekaman dihentikan karena sensor dimatikan.",
        });
        return;
      }

      const snap = src.getSnapshot();
      const newSample = buildSample(snap, {
        label: selectedLabel,
        label_type: snap.lockedSpotId !== "gps_asli" ? "simulated" : labelType,
        note,
        device: effectiveDeviceName,
      });

      setSamples((prev) => {
        const next = [...prev, newSample];
        const capped =
          next.length > MAX_STORED_SAMPLES
            ? next.slice(next.length - MAX_STORED_SAMPLES)
            : next;
        try {
          localStorage.setItem(STORAGE_KEY_SAMPLES, JSON.stringify(capped));
        } catch {
          setStorageNotice({
            type: "error",
            text: "Kuota localStorage penuh! Segera unduh atau salin JSON.",
          });
        }
        return capped;
      });

      count += 1;
      setRecordedInBatch(count);

      if (count >= target) {
        stopRecordingBatch();
        setStorageNotice({
          type: "info",
          text: `Berhasil merekam ${target} sampel untuk label ${selectedLabel}.`,
        });
      }
    };

    // Ambil sampel pertama langsung, lalu tiap 2000 ms
    captureOne();
    if (target > 1) {
      recordTimerRef.current = setInterval(captureOne, 2000);
    }
  };

  const handleDownloadJson = () => {
    const fileObj = buildFile({ device: effectiveDeviceName }, samples);
    const jsonStr = JSON.stringify(fileObj, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = toFilename(effectiveDeviceName, Date.now());
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStorageNotice({
      type: "info",
      text: `File ${a.download} (${samples.length} sampel) siap diunduh.`,
    });
  };

  const handleCopyClipboard = async () => {
    const fileObj = buildFile({ device: effectiveDeviceName }, samples);
    const jsonStr = JSON.stringify(fileObj, null, 2);
    try {
      await navigator.clipboard.writeText(jsonStr);
      setStorageNotice({
        type: "info",
        text: `Berhasil menyalin JSON (${samples.length} sampel) ke clipboard.`,
      });
    } catch {
      setStorageNotice({
        type: "error",
        text: "Gagal menyalin ke clipboard. Gunakan tombol Unduh JSON.",
      });
    }
  };

  const handleClearAll = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    persistSamples([]);
    setConfirmClear(false);
    setStorageNotice({
      type: "info",
      text: "Seluruh sampel rekaman di localStorage telah dihapus.",
    });
  };

  const geoSummary = computePoiCategorySummary(
    livePreview.snapshot.lat,
    livePreview.snapshot.lon,
    SERVER_POI
  );

  const dashboardSpotInfo = computePoiCategorySummary(
    livePreview.snapshot.lat,
    livePreview.snapshot.lon,
    POI_SPOTS
  );

  const effectiveSpeedPreview = resolveEffectiveSpeedMps(
    livePreview.snapshot.lockedSpotId,
    livePreview.snapshot.speed_mps
  );

  const consistencyWarnings = checkConsistency(
    {
      local_time: livePreview.localTime,
      lat: livePreview.snapshot.lat,
      lon: livePreview.snapshot.lon,
      db: livePreview.snapshot.db,
      label: selectedLabel,
    },
    SERVER_POI
  );

  const countsByLabel = LABELS.reduce((acc, lbl) => {
    acc[lbl] = 0;
    return acc;
  }, {} as Record<LabelEnum, number>);
  for (const s of samples) {
    if (countsByLabel[s.label] !== undefined) {
      countsByLabel[s.label] += 1;
    }
  }

  return (
    <div className="p-4 sm:p-5 rounded-3xl bg-slate-50/90 border border-slate-200/80 space-y-4">
      {/* Header Perekam */}
      <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-slate-200/70">
        <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900 min-w-0">
          <Database className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
          <span className="truncate">Perekam Data Lapangan (?record=1)</span>
        </span>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold shrink-0">
          {samples.length} / 50+ sampel
        </span>
      </div>

      {/* Pengingat wajib 20 detik */}
      <div className="p-2.5 rounded-2xl bg-indigo-50/80 border border-indigo-200/80 text-[11px] text-indigo-900 font-medium leading-snug">
        Setelah pindah lokasi, tunggu &gt;= 20 detik diam sebelum merekam agar{" "}
        <span className="font-mono font-bold">speed_mps</span> stabil.
      </div>

      {/* 1. Pilihan Perangkat HP */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
          <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>Perangkat HP</span>
        </label>
        <select
          value={selectedDeviceOption}
          onChange={(e) => handleSelectDevice(e.target.value)}
          disabled={isRecording}
          className="w-full px-3 py-2 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-800 focus:outline-none focus:border-slate-400"
        >
          {PRESET_DEVICES.map((dev) => (
            <option key={dev} value={dev}>
              {dev}
            </option>
          ))}
        </select>
        {selectedDeviceOption === "Lainnya" && (
          <input
            type="text"
            value={customDeviceName}
            onChange={(e) => handleCustomDeviceChange(e.target.value)}
            placeholder="Ketik nama HP (mis. Samsung A54)"
            maxLength={50}
            disabled={isRecording}
            className="w-full px-3 py-2 rounded-xl text-xs bg-white border border-slate-200 text-slate-800 focus:outline-none focus:border-slate-400"
          />
        )}
      </div>

      {/* 2. Pilihan Label & Label Type */}
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
          <Tag className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>Label Target &amp; Jenis Data</span>
        </label>
        <select
          value={selectedLabel}
          onChange={(e) => setSelectedLabel(e.target.value as LabelEnum)}
          disabled={isRecording}
          className="w-full px-3 py-2 rounded-xl text-xs font-mono font-bold bg-white border border-slate-200 text-slate-900 focus:outline-none focus:border-slate-400"
        >
          {LABELS.map((lbl) => (
            <option key={lbl} value={lbl}>
              {lbl}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-2">
          {(["real", "simulated"] as const).map((t) => {
            const active = effectiveLabelType === t;
            const disabledByLock = t === "real" && isLockedCoord;
            return (
              <button
                key={t}
                type="button"
                disabled={isRecording || disabledByLock}
                onClick={() => setLabelType(t)}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-all ${
                  active
                    ? "bg-slate-900 text-white border-slate-900"
                    : disabledByLock
                    ? "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                label_type: {t}
              </button>
            );
          })}
        </div>
        {isLockedCoord && (
          <p className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200/80 rounded-lg px-2.5 py-1.5 font-medium leading-snug">
            Koordinat sedang dikunci ke POI demo (
            <span className="font-mono">
              locked:{livePreview.snapshot.lockedSpotId}
            </span>
            ). Pilihan <span className="font-mono font-bold">real</span>{" "}
            dinonaktifkan dan <span className="font-mono font-bold">label_type</span>{" "}
            dipaksa menjadi <span className="font-mono font-bold">simulated</span>.
          </p>
        )}
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Gunakan <span className="font-mono font-semibold">real</span> HANYA
          jika lokasi (GPS asli) dan suara benar-benar asli. Gunakan{" "}
          <span className="font-mono font-semibold">simulated</span> bila
          koordinat dikunci ke POI demo atau memakai suara buatan
          (musik/speaker). Kunci waktu demo hanya mengubah{" "}
          <span className="font-mono">time_source</span>, bukan{" "}
          <span className="font-mono">label_type</span>.
        </p>
      </div>

      {/* 3. Input Catatan (Note) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 font-bold text-slate-700">
            <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span>Catatan Lapangan (note)</span>
          </span>
          <span className="text-[10px] font-mono text-slate-400">
            {note.length}/120
          </span>
        </div>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 120))}
          maxLength={120}
          disabled={isRecording}
          placeholder="Mis. kamar kos tenang, jalan kaki ke kampus..."
          className="w-full px-3 py-2 rounded-xl text-xs bg-white border border-slate-200 text-slate-800 focus:outline-none focus:border-slate-400"
        />
      </div>

      {/* 5. Panel Ringkasan Live & Peringatan Konsistensi */}
      <div className="p-3 rounded-2xl bg-white border border-slate-200/80 space-y-2.5">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-800 border-b border-slate-100 pb-1.5">
          <span>Ringkasan Live &amp; Jarak 4 POI</span>
          <span className="font-mono text-[10px] text-slate-500">
            {livePreview.localTime} WIB ({livePreview.derivedTimeLabel})
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[11px]">
          <div className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 flex justify-between">
            <span className="text-slate-500">Kampus:</span>
            <span className="font-mono font-bold text-slate-800">
              {Math.round(geoSummary.kampus.distM)}m
            </span>
          </div>
          <div className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 flex justify-between">
            <span className="text-slate-500">Masjid:</span>
            <span className="font-mono font-bold text-slate-800">
              {Math.round(geoSummary.masjid.distM)}m
            </span>
          </div>
          <div className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 flex justify-between">
            <span className="text-slate-500">Kos:</span>
            <span className="font-mono font-bold text-slate-800">
              {Math.round(geoSummary.kos.distM)}m
            </span>
          </div>
          <div className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 flex justify-between">
            <span className="text-slate-500">Bar:</span>
            <span className="font-mono font-bold text-slate-800">
              {Math.round(geoSummary.bar.distM)}m
            </span>
          </div>
        </div>
        <div className="text-[10px] text-slate-400 leading-tight">
          Info spot dashboard terdekat: Kos ({dashboardSpotInfo.kos.nearestSpotName},{" "}
          {Math.round(dashboardSpotInfo.kos.distM)}m) · Bar (
          {dashboardSpotInfo.bar.nearestSpotName},{" "}
          {Math.round(dashboardSpotInfo.bar.distM)}m)
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono text-slate-600 pt-0.5">
          <div className="truncate">
            dB:{" "}
            <span className="font-bold text-slate-900">
              {livePreview.snapshot.db.toFixed(1)}
            </span>
          </div>
          <div className="truncate">
            speed:{" "}
            <span className="font-bold text-slate-900">
              {effectiveSpeedPreview.toFixed(2)}
            </span>
          </div>
          <div className="truncate">
            time_src:{" "}
            <span className="font-bold text-slate-900">
              {livePreview.snapshot.timeMode === "auto" ? "real" : "sim"}
            </span>
          </div>
        </div>

        {consistencyWarnings.length > 0 ? (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200/80 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Peringatan Konsistensi (Tidak Memblokir):</span>
            </div>
            <ul className="list-disc list-inside text-[10px] text-amber-900 space-y-0.5 leading-snug">
              {consistencyWarnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="px-2.5 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200/80 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>Kombinasi label, jam, lokasi, dan dB sudah konsisten.</span>
          </div>
        )}
      </div>

      {/* 4. Pilihan Ukuran Batch N = 5 / 10 / 20 & Tombol Rekam */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-slate-700">
            Jumlah Sampel per Batch (1 sampel / 2 dtk)
          </span>
          <div className="flex items-center gap-1">
            {([5, 10, 20] as const).map((n) => (
              <button
                key={n}
                type="button"
                disabled={isRecording}
                onClick={() => setBatchSize(n)}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all ${
                  batchSize === n
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {blockReasons.length > 0 && !isRecording && (
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] text-rose-800 space-y-1 leading-snug">
            <p className="font-bold">Tombol Rekam dikunci karena:</p>
            <ul className="list-disc list-inside text-[10px] space-y-0.5">
              {blockReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        {isRecording ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 py-3 px-4 rounded-2xl bg-indigo-600 text-white text-xs font-bold flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
              <span>
                Merekam... ({recordedInBatch} / {batchSize})
              </span>
            </div>
            <button
              type="button"
              onClick={stopRecordingBatch}
              className="py-3 px-4 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center gap-1.5 shrink-0"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Batal</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={!canStartRecording}
            onClick={startRecordingBatch}
            className={`w-full py-3 px-4 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm ${
              canStartRecording
                ? "bg-indigo-600 hover:bg-indigo-700 text-white"
                : "bg-slate-200 text-slate-500 cursor-not-allowed"
            }`}
          >
            <Play className="w-4 h-4 fill-current" />
            <span>Rekam {batchSize} Sampel</span>
          </button>
        )}
      </div>

      {/* Notifikasi Aksi / Storage */}
      {storageNotice && (
        <div
          className={`p-2.5 rounded-xl text-[11px] font-medium border ${
            storageNotice.type === "error"
              ? "bg-rose-50 text-rose-800 border-rose-200"
              : storageNotice.type === "warning"
              ? "bg-amber-50 text-amber-800 border-amber-200"
              : "bg-sky-50 text-sky-900 border-sky-200"
          }`}
        >
          {storageNotice.text}
        </div>
      )}

      {/* 6. Penghitung Sampel per Label */}
      <div className="p-3 rounded-2xl bg-white border border-slate-200/80 space-y-2">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-800">
          <span>Tersimpan di Browser</span>
          <span className="font-mono text-xs text-indigo-700">
            Total: {samples.length} (Target &gt;= 50)
          </span>
        </div>
        <div className="grid grid-cols-1 gap-1 text-[10px] font-mono">
          {LABELS.map((lbl) => (
            <div
              key={lbl}
              className="flex items-center justify-between px-2 py-1 rounded-lg bg-slate-50 border border-slate-100"
            >
              <span className="truncate text-slate-700 mr-2">{lbl}</span>
              <span className="font-bold text-slate-900 shrink-0">
                {countsByLabel[lbl]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 7. Tombol Ekspor & Hapus */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={samples.length === 0}
          onClick={handleDownloadJson}
          className="py-2.5 px-3 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-400 text-white flex items-center justify-center gap-1.5 transition-colors"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>Unduh JSON</span>
        </button>

        <button
          type="button"
          disabled={samples.length === 0}
          onClick={handleCopyClipboard}
          className="py-2.5 px-3 rounded-xl text-xs font-bold bg-white hover:bg-slate-100 disabled:bg-slate-100 disabled:text-slate-400 text-slate-800 border border-slate-200 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Copy className="w-3.5 h-3.5 shrink-0" />
          <span>Salin ke Clipboard</span>
        </button>

        <button
          type="button"
          disabled={samples.length === 0}
          onClick={handleClearAll}
          className={`col-span-2 py-2 px-3 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition-colors ${
            confirmClear
              ? "bg-rose-600 text-white border-rose-600"
              : "bg-white hover:bg-rose-50 text-rose-600 border-rose-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200"
          }`}
        >
          <Trash2 className="w-3.5 h-3.5 shrink-0" />
          <span>
            {confirmClear
              ? "Yakin hapus semua sampel? Ketuk sekali lagi"
              : "Hapus Semua"}
          </span>
        </button>
      </div>
    </div>
  );
}

