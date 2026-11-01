#!/usr/bin/env node
/**
 * Skrip penggabung beberapa file hasil unduhan perekam lapangan (?record=1) di /anak.
 *
 * Cara pakai:
 *   node scripts/merge-field-samples.mjs <file1.json> <file2.json> ... --out ../server/ml/data/real_field_samples.json
 */
import fs from "node:fs";
import path from "node:path";

const VALID_LABELS = new Set([
  "SEDANG_KULIAH",
  "ALERT_BOLOS_KULIAH",
  "WARNING_BELUM_KE_MASJID",
  "ISTIRAHAT_DI_KOS",
  "CRITICAL_TERDETEKSI_DI_BAR",
  "ANOMALY_FAKE_GPS",
  "NORMAL",
]);

const VALID_TIME_SOURCES = new Set(["real", "simulated"]);
const VALID_LABEL_TYPES = new Set(["real", "simulated"]);

function printUsageAndExit(msg) {
  if (msg) {
    console.error(`[ERROR] ${msg}`);
  }
  console.error(
    "Penggunaan: node scripts/merge-field-samples.mjs <file1.json> [file2.json ...] --out <output.json> [--include-warned]"
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const inputFiles = [];
let outPath = null;
let includeWarned = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") {
    if (i + 1 >= args.length) {
      printUsageAndExit("Argumen --out membutuhkan path file tujuan.");
    }
    outPath = args[i + 1];
    i += 1;
  } else if (args[i] === "--include-warned") {
    includeWarned = true;
  } else if (args[i].startsWith("--")) {
    printUsageAndExit(`Flag tidak dikenal: ${args[i]}`);
  } else {
    inputFiles.push(args[i]);
  }
}

if (inputFiles.length === 0) {
  printUsageAndExit("Minimal satu file input JSON harus diberikan.");
}
if (!outPath) {
  printUsageAndExit("Flag --out <output.json> wajib diberikan.");
}

function validateSample(sample, fileLabel, index) {
  const ctx = `${fileLabel} [samples[${index}]]`;
  if (!sample || typeof sample !== "object") {
    throw new Error(`${ctx}: sampel bukan objek.`);
  }
  const numFields = [
    "timestamp_ms",
    "lat",
    "lon",
    "accuracy_m",
    "rms",
    "db",
    "speed_mps",
  ];
  for (const f of numFields) {
    if (typeof sample[f] !== "number" || !Number.isFinite(sample[f])) {
      throw new Error(`${ctx}: field '${f}' harus angka terhingga.`);
    }
  }
  if (
    typeof sample.local_time !== "string" ||
    !/^\d{2}:\d{2}$/.test(sample.local_time)
  ) {
    throw new Error(
      `${ctx}: field 'local_time' harus berformat HH:MM (dapat: ${JSON.stringify(
        sample.local_time
      )}).`
    );
  }
  if (!VALID_TIME_SOURCES.has(sample.time_source)) {
    throw new Error(
      `${ctx}: field 'time_source' tidak valid (${JSON.stringify(
        sample.time_source
      )}).`
    );
  }
  if (!VALID_LABELS.has(sample.label)) {
    throw new Error(
      `${ctx}: label tidak valid (${JSON.stringify(
        sample.label
      )}). Harus salah satu dari: ${Array.from(VALID_LABELS).join(", ")}.`
    );
  }
  if (!VALID_LABEL_TYPES.has(sample.label_type)) {
    throw new Error(
      `${ctx}: field 'label_type' tidak valid (${JSON.stringify(
        sample.label_type
      )}).`
    );
  }
  if (typeof sample.note !== "string") {
    throw new Error(`${ctx}: field 'note' harus string.`);
  }
}

const allSamples = [];
const deviceSet = new Set();

for (const filePath of inputFiles) {
  let rawText;
  try {
    rawText = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`[ERROR] Gagal membaca file ${filePath}: ${err.message}`);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    console.error(`[ERROR] JSON tidak valid di ${filePath}: ${err.message}`);
    process.exit(1);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.samples)) {
    console.error(
      `[ERROR] Struktur file ${filePath} tidak memiliki array 'samples'.`
    );
    process.exit(1);
  }

  const fileDevice =
    parsed.meta &&
    typeof parsed.meta.device === "string" &&
    parsed.meta.device.trim()
      ? parsed.meta.device.trim()
      : "Unknown Device";

  for (let i = 0; i < parsed.samples.length; i++) {
    const s = parsed.samples[i];
    try {
      validateSample(s, filePath, i);
    } catch (err) {
      console.error(`[ERROR] ${err.message}`);
      process.exit(1);
    }

    const sampleDevice =
      typeof s.device === "string" && s.device.trim()
        ? s.device.trim()
        : fileDevice;
    deviceSet.add(sampleDevice);

    allSamples.push({
      ...s,
      device: sampleDevice,
    });
  }
}

// Buang duplikat berdasarkan device + recorded_at_ms (fallback ke kunci lama untuk file lama),
// buang sampel yang audio_mode !== "raw", dan buang sampel dengan consistency_warnings tidak kosong
// kecuali --include-warned diberikan.
const seenKeys = new Set();
const dedupedSamples = [];
let duplicateCount = 0;
let nonRawDroppedCount = 0;
let warnedDroppedCount = 0;
const warnedDroppedByLabel = {};
const warnReasonCounts = {};

for (const s of allSamples) {
  const hasRecordedAt =
    typeof s.recorded_at_ms === "number" && Number.isFinite(s.recorded_at_ms);
  const key = hasRecordedAt
    ? `${s.device}|${s.recorded_at_ms}`
    : `${s.timestamp_ms}|${s.device}|${s.lat}|${s.lon}`;

  if (seenKeys.has(key)) {
    duplicateCount += 1;
    continue;
  }
  seenKeys.add(key);

  if (!includeWarned && s.audio_mode !== "raw") {
    nonRawDroppedCount += 1;
    continue;
  }

  const warnings = Array.isArray(s.consistency_warnings)
    ? s.consistency_warnings
    : [];
  if (!includeWarned && warnings.length > 0) {
    warnedDroppedCount += 1;
    warnedDroppedByLabel[s.label] = (warnedDroppedByLabel[s.label] || 0) + 1;
    for (const w of warnings) {
      const reason = String(w);
      warnReasonCounts[reason] = (warnReasonCounts[reason] || 0) + 1;
    }
    continue;
  }

  dedupedSamples.push(s);
}

// Urutkan menurut recorded_at_ms naik (fallback timestamp_ms bila tidak ada)
dedupedSamples.sort((a, b) => {
  const ta =
    typeof a.recorded_at_ms === "number" && Number.isFinite(a.recorded_at_ms)
      ? a.recorded_at_ms
      : a.timestamp_ms;
  const tb =
    typeof b.recorded_at_ms === "number" && Number.isFinite(b.recorded_at_ms)
      ? b.recorded_at_ms
      : b.timestamp_ms;
  return ta - tb;
});

const devicesList = Array.from(deviceSet);
const mergedOutput = {
  meta: {
    recorded_by: "wendi",
    device: devicesList.join(", "),
    version: 1,
  },
  samples: dedupedSamples,
};

const resolvedOut = path.resolve(outPath);
fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
fs.writeFileSync(
  resolvedOut,
  JSON.stringify(mergedOutput, null, 2) + "\n",
  "utf8"
);

// Cetak ringkasan jumlah per label dan per device
const labelCounts = {};
for (const lbl of VALID_LABELS) {
  labelCounts[lbl] = 0;
}
const deviceCounts = {};
for (const s of dedupedSamples) {
  labelCounts[s.label] = (labelCounts[s.label] || 0) + 1;
  deviceCounts[s.device] = (deviceCounts[s.device] || 0) + 1;
}

console.log("=== RINGKASAN PENGGABUNGAN SAMPEL LAPANGAN ===");
console.log(`File input     : ${inputFiles.length} file`);
console.log(`Total dibaca   : ${allSamples.length} sampel`);
console.log(`Duplikat buang : ${duplicateCount} sampel`);
console.log(
  `Non-raw buang  : ${nonRawDroppedCount} sampel (${
    includeWarned
      ? "--include-warned aktif"
      : "default: hanya terima audio_mode === 'raw'"
  })`
);
console.log(
  `Peringatan buang: ${warnedDroppedCount} sampel (${
    includeWarned ? "--include-warned aktif" : "default: buang tidak konsisten"
  })`
);
console.log(`Total akhir    : ${dedupedSamples.length} sampel`);
console.log(`Output disimpan: ${resolvedOut}`);

if (warnedDroppedCount > 0) {
  console.log("\nSampel Dibuang karena Peringatan (per Label):");
  for (const [lbl, cnt] of Object.entries(warnedDroppedByLabel)) {
    console.log(`  - ${lbl.padEnd(28)}: ${cnt}`);
  }
  const topReasons = Object.entries(warnReasonCounts).sort(
    (a, b) => b[1] - a[1]
  );
  console.log("\nAlasan Peringatan Terbanyak:");
  for (const [reason, cnt] of topReasons.slice(0, 5)) {
    console.log(`  - (${cnt}x) ${reason}`);
  }
}

console.log("\nJumlah Akhir per Label:");
for (const [lbl, cnt] of Object.entries(labelCounts)) {
  console.log(`  - ${lbl.padEnd(28)}: ${cnt}`);
}
console.log("\nJumlah Akhir per Device:");
for (const [dev, cnt] of Object.entries(deviceCounts)) {
  console.log(`  - ${dev.padEnd(28)}: ${cnt}`);
}
