# Modul Dashboard (Next.js 14 App Router) - isDugem

Modul ini adalah pusat pemantauan (command center) real-time berbasis web modern yang dibuka oleh pengguna/orang tua di browser laptop saat presentasi demo maupun pemantauan sehari-hari.

---

## 1. Tech Stack
- **Framework:** Next.js 14 (App Router) + TypeScript
- **Styling:** Tailwind CSS (Modern Glassmorphism & Liquid Slate Theme)
- **Visualisasi Peta:** `react-leaflet` + Leaflet (OpenStreetMap / CartoDB tile layer)
- **Visualisasi Grafik:** `recharts` (Histori desibel suara dan jarak POI)
- **Komunikasi Real-time:** `mqtt` (npm package, MQTT over WebSocket WSS port 8884)
- **Icons:** `lucide-react`

---

## 2. Struktur Komponen Utama

1. `components/MapPanel.tsx` & `components/LeafletMapInner.tsx`: Peta interaktif live marker posisi HP Anak dan HP Orang Tua, rute jalan dinamis, dan lingkaran geofence untuk tiap POI (Kampus, Masjid, Kos, Bar).
2. `components/KpiStrip.tsx`: Tampilan 3 metrik KPI status sistem keputusan, tingkat desibel suara langsung dengan visualizer, dan kecepatan gerak.
3. `components/SystemControlPanel.tsx`: Panel kendali sistem berisi 3 tombol aksi cepat (Ping, Ingatkan, Alarm), status telemetri 2 sensor HP Ortu (GPS + Shake), input pesan khusus, dan log kejadian.
4. `components/DemoPresetPanel.tsx`: Panel simulasi skenario pengujian demo (preset jam dan lokasi POI) untuk verifikasi tanpa berjalan kaki fisik.
5. `components/HistoryChart.tsx`: Grafik time-series tren desibel suara dan jarak geofence terkini.
6. `components/Sidebar.tsx`: Navigasi tab utama (Overview, Map, Analytics, Simulator), indikator status koneksi broker, dan tombol buka QR code.
7. `components/QrConnectModal.tsx`: Modal scan QR code cepat untuk menghubungkan HP Anak (`/anak`) dan HP Ortu (`/ortu`).
8. `hooks/useMqtt.ts`: Custom hook koneksi MQTT WebSocket, auto-reconnect, subscription topik telemetri, alert, dan command.
9. `hooks/useTelemetryStore.ts`: State management telemetri, histori grafik, jejak rute perjalanan, dan event log.
10. `lib/types.ts`: Interface TypeScript yang identik dengan kontrak data di `docs/mqtt-schema.md`.

---

## 3. Cara Menjalankan Modul Secara Lokal

1. Salin konfigurasi environment:
   ```bash
   cp .env.local.example .env.local
   ```
2. Jalankan server pengembang:
   ```bash
   npm run dev
   ```
3. Buka peramban pada [http://localhost:3000](http://localhost:3000).

---

## 4. Rute Halaman (App Router)

- `/` : Dashboard Pusat Kendali (Laptop / Layar Lebar)
- `/anak` : Antarmuka HP Anak (Sensor GPS Hardware, Mikrofon dB, Akselerometer, dan Pantauan Lokasi GPS Ortu)
- `/ortu` : Antarmuka HP Orang Tua (Sensor GPS Hardware, Akselerometer Shake-to-Ping, dan Pantauan Status Anak)
