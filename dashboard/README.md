# Modul Dashboard (Next.js 14 App Router) — RantauGuard

Modul ini adalah pusat pemantauan (command center) real-time berbasis web modern yang dibuka oleh pengguna/orang tua di browser laptop saat presentasi demo.

---

## 1. Tech Stack
- **Framework:** Next.js 14 (App Router) + TypeScript
- **Styling:** Tailwind CSS (Dark Mode Slate/Zinc theme)
- **Visualisasi Peta:** `react-leaflet` + Leaflet (CartoDB Dark Matter tile layer)
- **Visualisasi Grafik:** `recharts` (Jarak POI & desibel suara)
- **Komunikasi Real-time:** `mqtt` (npm package, MQTT over WebSocket WSS port 8884)
- **Icons:** `lucide-react`

---

## 2. Rencana Inisialisasi Proyek (Dilakukan oleh Lead Dashboard)

Inisialisasi aplikasi Next.js di branch kerja `dashboard/setup`:
```bash
# Di dalam folder dashboard/
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"

# Pasang dependensi tambahan
npm install mqtt react-leaflet leaflet recharts lucide-react
npm install -D @types/leaflet
```

---

## 3. Komponen Wajib (Sesuai PRD Bagian 8.7)

1. `components/MapPanel.tsx` — Peta interaktif CartoDB Dark Matter, live marker posisi HP anak, dan lingkaran geofence untuk tiap POI (Kampus, Masjid, Kos, Bar).
2. `components/AudioVisualizer.tsx` — Bar animasi equalizer real-time berdasarkan level `db` terkini (`Hening < 55`, `Normal 55–75`, `Bising > 75`).
3. `components/StatusCard.tsx` — Kartu indikator status besar sesuai enum `AlertStatus` dengan aksen warna dinamis (Hijau, Kuning, Merah, Ungu Anomali).
4. `components/CommandCenter.tsx` — Panel kontrol 3 tombol aksi cepat:
   - `command/ping`
   - `command/reminder`
   - `command/alarm`
5. `components/DemoPresetPanel.tsx` — Fitur simulasi demo kelas (preset jam kuliah/sholat/malam & tombol loncat lokasi POI) untuk mem-publish telemetri mock langsung ke broker tanpa berjalan fisik.
6. `components/HistoryChart.tsx` — Grafik time-series tren desibel suara dan jarak geofence terkini.
7. `hooks/useMqtt.ts` — Custom hook koneksi MQTT WebSocket, auto-reconnect, subscription topik `alerts` dan `edge/+/telemetry`.
8. `hooks/useTelemetryStore.ts` — State management telemetri terkini dan histori 60 data terakhir.
9. `lib/types.ts` — Interface TypeScript yang identik dengan kontrak payload di `docs/mqtt-schema.md`.
10. `lib/mockData.ts` — Data tiruan untuk pengujian UI tanpa broker (`NEXT_PUBLIC_USE_MOCK=true`).

---

## 4. Cara Menjalankan Modul Secara Lokal

1. Salin konfigurasi environment:
   ```bash
   cp .env.local.example .env.local
   ```
2. Jalankan server pengembang:
   ```bash
   npm run dev
   ```
3. Buka browser pada [http://localhost:3000](http://localhost:3000).
