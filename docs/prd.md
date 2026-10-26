# PRD - RantauGuard
### Smart Student & Parental Guardian System
**Mata Kuliah:** Internet of Things - Tugas Praktek Multicommunication 2 Arah & Multisensor
**Tim:** 3 orang · **Deadline:** 1 minggu dari briefing tugas
**Versi dokumen:** v2.1 - All-in-One Vercel HTTPS Cloud Deployment (Next.js App Router)

---

## 0. Cara Pakai Dokumen Ini

Dokumen ini ditulis supaya setiap bagian bisa langsung di-copy ke AI coding agent (Claude Code, Cursor, dll) per modul, tanpa perlu konteks tambahan. Setiap modul punya: tanggung jawab, struktur folder, kontrak data (schema persis), dan definisi fungsi. Jangan ubah nama topic MQTT atau field JSON tanpa update dokumen ini - ketiga modul saling bergantung pada kontrak ini.

---

## 1. Latar Belakang & Masalah

Mahasiswa rantau sering sulit dipantau orang tua: GPS saja bisa dimanipulasi (*fake GPS*), seolah-olah di kos/masjid padahal di tempat lain. Kombinasi **lokasi (GPS)** + **suasana suara (mikrofon)** saling memvalidasi - lokasi bisa dipalsukan, suasana suara ruangan (hening masjid vs dentuman bar) jauh lebih sulit dipalsukan konsisten.

## 2. Tujuan Produk

1. Verifikasi otomatis lokasi & suasana anak secara real-time untuk orang tua.
2. Deteksi anomali (klaim lokasi tidak cocok dengan suara sekitar → indikasi fake GPS).
3. Komunikasi 2 arah: anak → ortu (telemetry & alert), ortu → anak (perintah/pengingat).
4. Memenuhi 100% ketentuan tugas, menang di komponen Ide & Orisinalitas + Data Processing/Algoritma + dashboard yang menonjol secara visual.

## 3. Pemetaan ke Ketentuan Tugas

| # | Ketentuan Tugas | Pemenuhan |
|---|---|---|
| 1 | Kelompok 3-4 orang | Tim 3 orang (Bagian 10) |
| 2 | Min. 2 edge device, min. 2 sensor | Edge 1 = HP Anak (GPS + Mikrofon + Accelerometer); Edge 2 = HP Ortu (Accelerometer/Gyroscope shake-to-ping + lokasi rumah) |
| 3 | Min. 2 data processing | Haversine distance geofencing; Audio RMS → desibel |
| 4 | Algoritma AI/lain | Context-Aware Fusion Decision Table (rule-based classifier) |
| 5 | Min. 1 protokol ke cloud | MQTT over TLS/WSS (broker publik HiveMQ) |
| 6 | Dashboard satu jaringan (opsional) | Dibuat sebagai fitur andalan - Next.js app |
| 7 | Ide tidak boleh sama kelompok lain | Kombinasi GPS+Audio+shake-to-ping, belum ada di contoh dosen |

## 4. Tech Stack & Deployment Architecture

| Modul | Stack | Alasan |
|---|---|---|
| Edge device (Anak & Ortu) | **Next.js App Router Client Pages (`/anak`, `/ortu`)** (Geolocation API + Web Audio API + DeviceMotion API) dengan fallback file statis di `edge/` | Berjalan di browser HP via HTTPS resmi Vercel, bebas pembatasan sensor browser, scan via QR code tanpa install APK |
| Backend processing | **Python 3.11+**, `paho-mqtt`, `python-dotenv` | Sesuai contoh dosen (PocketGuard), mudah untuk logic Haversine/RMS/decision table |
| Dashboard (Command Center) | **Next.js 14 (App Router) + TypeScript + Tailwind CSS** di rute utama `/` | Komponen reusable, mudah bikin UI "gokil" (peta live CartoDB, visualizer, command center, simulator demo) |
| Cloud Hosting Web | **Vercel** (Single All-in-One Deployment) | Menyediakan domain HTTPS gratis otomatis, akses via QR code, mencegah pemblokiran sensor di Android & iOS |
| Peta | `react-leaflet` + CartoDB Dark Matter tile | Dark mode map, ringan, gratis |
| Grafik histori | `recharts` | Native React, gampang di-style dark mode |
| MQTT di browser | `mqtt` (npm package, MQTT over WebSocket/WSS port 8884) | Standar untuk komunikasi real-time dari browser HP dan laptop |
| Broker | HiveMQ publik - `broker.hivemq.com` (8883 TLS untuk server, 8884 WSS untuk web browser) | Gratis, tanpa akun, dipakai di contoh dosen |

> Catatan Arsitektur Vercel: Dashboard (`/`), HP Anak (`/anak`), dan HP Ortu (`/ortu`) disatukan dalam satu proyek Next.js yang di-deploy ke Vercel. Dengan demikian, tim hanya memiliki 1 domain HTTPS resmi (misal: `https://isdugem.vercel.app`). HP anak dan HP ortu cukup memindai QR Code untuk membuka antarmuka masing-masing dengan izin mikrofon & GPS yang langsung aktif tanpa hambatan keamanan browser HTTP.

## 5. Struktur Repo (Monorepo)

```
isDugem/
├── README.md
├── .gitignore
├── .env.example                    # referensi semua env var lintas modul
├── docs/
│   ├── prd.md                      # dokumen PRD v2.1
│   ├── mqtt-schema.md              # kontrak payload MQTT (Bagian 7)
│   └── demo-script.md              # skenario demo untuk presentasi
├── edge/                           # Implementasi standalone fallback (HTML/JS statis)
│   ├── anak/
│   │   ├── index.html
│   │   ├── app.js
│   │   └── style.css
│   └── ortu/
│       ├── index.html
│       ├── app.js
│       └── style.css
├── server/                         # backend processing (Anggota 2)
│   ├── requirements.txt
│   ├── .env.example
│   ├── config.py
│   ├── mqtt_client.py
│   ├── processing/
│   │   ├── __init__.py
│   │   ├── haversine.py
│   │   ├── audio_rms.py
│   │   └── decision_engine.py
│   ├── models.py                   # dataclass Telemetry, Alert
│   ├── main.py                     # entrypoint: subscribe, process, publish
│   └── tests/
│       ├── test_haversine.py
│       ├── test_audio_rms.py
│       └── test_decision_engine.py
└── dashboard/                      # Next.js 14 App (Hosting Vercel - Anggota 1 & 3)
    ├── package.json
    ├── tsconfig.json
    ├── tailwind.config.ts
    ├── .env.local.example
    ├── app/
    │   ├── layout.tsx
    │   ├── globals.css
    │   ├── page.tsx                # Rute Utama: Dashboard Laptop Ortu (Anggota 3)
    │   ├── anak/
    │   │   └── page.tsx            # Rute HP Anak: Sensor GPS, Audio dB, Accel (Anggota 1)
    │   └── ortu/
    │       └── page.tsx            # Rute HP Ortu: Shake-to-Ping & Remote (Anggota 1)
    ├── components/
    │   ├── MapPanel.tsx            # peta dark-mode + geofence
    │   ├── AudioVisualizer.tsx     # equalizer live
    │   ├── StatusCard.tsx          # status klasifikasi besar
    │   ├── CommandCenter.tsx       # tombol alarm/pengingat/ping
    │   ├── DemoPresetPanel.tsx     # simulasi jam & lokasi
    │   └── HistoryChart.tsx        # grafik jarak & dB
    ├── hooks/
    │   ├── useMqtt.ts              # koneksi MQTT WebSocket + subscribe
    │   └── useTelemetryStore.ts    # state telemetry terkini + histori
    ├── lib/
    │   ├── mqttTopics.ts           # konstanta topic (Bagian 7)
    │   ├── types.ts                # TypeScript types kontrak data
    │   └── mockData.ts             # data dummy untuk pengujian lokal
    └── public/
```

## 6. Standar Repo & Branching (WAJIB - karena kerja paralel 3 orang)

### 6.1 Branch Strategy
- `main` - selalu stabil, hanya menerima merge dari `develop` setelah semua modul tergabung dan teruji.
- `develop` - branch integrasi, tempat semua fitur digabung sebelum ke `main`.
- Branch kerja per orang, prefix sesuai modul:
  - `edge/anak-<deskripsi-singkat>` - Anggota 1
  - `server/<deskripsi-singkat>` - Anggota 2
  - `dashboard/<deskripsi-singkat>` - Anggota 3

  Contoh: `edge/anak-gps-mic-capture`, `server/decision-engine`, `dashboard/map-panel`.

### 6.2 Aturan Commit
Gunakan **Conventional Commits**:
```
feat(edge-anak): implementasi pembacaan GPS & mikrofon
fix(server): perbaiki perhitungan RMS saat array kosong
docs(prd): update kontrak payload alert
chore(dashboard): setup tailwind config
```
Tipe yang dipakai: `feat`, `fix`, `docs`, `chore`, `test`, `refactor`.

### 6.3 Aturan Pull Request / Merge
1. Setiap orang kerja di branch sendiri, push rutin (minimal 1x per hari kerja).
2. Sebelum merge ke `develop`: pastikan modul sendiri jalan standalone (edge bisa publish ke broker test, server bisa proses data dummy, dashboard bisa render dengan data mock).
3. Merge ke `develop` lewat Pull Request - **1 reviewer dari anggota lain** wajib approve (saling cek, bukan hanya self-merge), fokus review:
   - Nama topic MQTT & struktur payload **sama persis** dengan Bagian 7.
   - Tidak ada `.env`/credential ter-commit (cek `.gitignore`).
4. Urutan integrasi disarankan: `server` → `edge` → `dashboard`, karena dashboard butuh data riil dari server untuk testing akhir. Tapi dalam masa pengembangan, semua bisa jalan paralel memakai **mock data** (lihat Bagian 9).
5. Di H-1 deadline: freeze fitur baru, hanya bugfix, semua branch merge ke `develop` → test end-to-end bersama → merge `develop` → `main`.

### 6.4 File Wajib per Modul
Setiap folder modul (`edge/anak`, `edge/ortu`, `server`, `dashboard`) wajib punya:
- `.env.example` - daftar env var yang dibutuhkan (tanpa value asli).
- Tidak ada hardcoded `PROJECT_ID`, broker URL, atau kredensial di kode - semua lewat env var / config.

### 6.5 Konvensi Penamaan
- Nama variabel/fungsi: `camelCase` di JS/TS, `snake_case` di Python.
- Nama file komponen React: `PascalCase.tsx`.
- Konstanta topic MQTT dan field JSON: **persis seperti di Bagian 7**, jangan disingkat/diubah oleh modul manapun.

---

## 7. Kontrak Data - MQTT Topic & Payload (SUMBER KEBENARAN TUNGGAL)

**Broker:** `broker.hivemq.com`
**Port edge/server:** `8883` (MQTT over TLS)
**Port dashboard (browser):** `8884` (MQTT over WebSocket/WSS) → `wss://broker.hivemq.com:8884/mqtt`
**PROJECT_ID:** string unik kelompok, contoh `rantauguard_kelompok_07`, disimpan di env var `PROJECT_ID`, dipakai sebagai prefix semua topic.

### 7.1 Daftar Topic

| Topic | Publisher | Subscriber | QoS |
|---|---|---|---|
| `rantauguard/{PROJECT_ID}/edge/anak/telemetry` | Edge Anak | Server | 1 |
| `rantauguard/{PROJECT_ID}/edge/ortu/telemetry` | Edge Ortu | Server | 1 |
| `rantauguard/{PROJECT_ID}/alerts` | Server | Edge Anak, Edge Ortu, Dashboard | 1 |
| `rantauguard/{PROJECT_ID}/command/ping` | Edge Ortu (tombol shake), Dashboard | Edge Anak, Server | 1 |
| `rantauguard/{PROJECT_ID}/command/alarm` | Dashboard | Edge Anak | 1 |
| `rantauguard/{PROJECT_ID}/command/reminder` | Dashboard | Edge Anak | 1 |

### 7.2 Payload: `edge/anak/telemetry`
```json
{
  "device_id": "anak",
  "sequence": 42,
  "sent_at_ms": 1790000000000,
  "location": {
    "lat": -7.0502,
    "lon": 110.4398,
    "accuracy_m": 8.5
  },
  "audio": {
    "rms": 0.042,
    "db": 61.2
  },
  "motion": {
    "accel_magnitude": 9.9
  }
}
```

### 7.3 Payload: `edge/ortu/telemetry`
```json
{
  "device_id": "ortu",
  "sequence": 17,
  "sent_at_ms": 1790000000000,
  "location": { "lat": -7.0540, "lon": 110.4380 },
  "motion": {
    "accel_magnitude": 9.8,
    "shake_detected": false
  }
}
```

### 7.4 Payload: `alerts` (dari Server)
```json
{
  "status": "CRITICAL_TERDETEKSI_DI_BAR",
  "reason": "Jarak ke bar 42m, suara 81.3 dB pada jam 23:10",
  "timestamp_ms": 1790000000000,
  "context": {
    "time_label": "jam_malam",
    "nearest_poi": "bar",
    "distance_m": 42,
    "db": 81.3
  }
}
```
`status` adalah salah satu dari enum berikut (persis, dipakai sebagai key warna di dashboard):
`SEDANG_KULIAH | ALERT_BOLOS_KULIAH | WARNING_BELUM_KE_MASJID | ISTIRAHAT_DI_KOS | CRITICAL_TERDETEKSI_DI_BAR | ANOMALY_FAKE_GPS | NORMAL`

### 7.5 Payload: `command/ping`, `command/alarm`, `command/reminder`
```json
{ "triggered_by": "ortu", "timestamp_ms": 1790000000000, "message": "Orang tua sedang mengecek posisi Anda!" }
```

### 7.6 Titik Referensi (Geofence POI)
Didefinisikan sebagai konstanta yang dipakai server & dashboard (harus identik - area UNDIP Tembalang & Semarang Bawah / Kota Lama):
```json
{
  "kampus": { "lat": -7.0502, "lon": 110.4398, "radius_m": 150 },
  "masjid": { "lat": -7.0552, "lon": 110.4370, "radius_m": 100 },
  "kos": {
    "lat": -7.0632,
    "lon": 110.4385,
    "radius_m": 750,
    "sub_points": [
      { "name": "Kos Mulawarman", "lat": -7.067588, "lon": 110.439708 },
      { "name": "Kos Gondang", "lat": -7.062817, "lon": 110.440401 },
      { "name": "Kos Banjarsari", "lat": -7.059141, "lon": 110.435523 }
    ]
  },
  "bar": {
    "lat": -6.966984,
    "lon": 110.429807,
    "radius_m": 250,
    "sub_points": [
      { "name": "RedHare Semarang", "lat": -6.976429, "lon": 110.412950 },
      { "name": "Marabunta Kota Lama", "lat": -6.966445, "lon": 110.430036 },
      { "name": "Golden Tiger Semarang", "lat": -6.966984, "lon": 110.429807 },
      { "name": "HW Tiger Club Semarang", "lat": -6.965717, "lon": 110.429464 }
    ]
  }
}
```
(Nilai koordinat telah diverifikasi via Google Maps pada area nyata UNDIP Tembalang dan Kota Lama Semarang).

---

## 8. Spesifikasi Modul (untuk AI coding agent)

### 8.1 Edge Anak (`edge/anak/app.js`)
**Tanggung jawab:** baca GPS (Geolocation API, `watchPosition`), baca mikrofon (Web Audio API `AnalyserNode` → hitung RMS), baca accelerometer (`DeviceMotionEvent`), publish ke MQTT setiap 2-3 detik, subscribe ke `alerts` dan `command/*` untuk tampilkan notifikasi/alarm (pakai `navigator.vibrate` + tampilan on-screen).

Fungsi kunci yang harus ada:
- `getGpsReading(): Promise<{lat, lon, accuracy_m}>`
- `computeAudioDb(analyserNode): number` → hitung RMS dari time-domain data, konversi ke dB sesuai formula Bagian 8.3.
- `publishTelemetry(mqttClient, payload)` - payload sesuai skema 7.2.
- `onMessage(topic, payload)` - handle `alerts`/`command/*`, tampilkan UI + vibrate.

### 8.2 Edge Ortu (`edge/ortu/app.js`)
Sama seperti Edge Anak tapi: tidak perlu mikrofon; deteksi *shake* dari `DeviceMotionEvent` (threshold akselerasi > nilai tertentu dalam waktu singkat) → publish ke `command/ping`. UI punya tombol manual untuk alarm/pengingat/ping (redundan dengan dashboard, untuk demo tanpa laptop).

### 8.3 Formula Processing (dipakai di Edge & Server - HARUS identik hasilnya)

**Haversine (`server/processing/haversine.py`):**
```python
def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return distance in meters between two lat/lon points."""
```
Implementasi: formula standar Haversine, `R = 6_371_000`.

**Audio RMS → dB (`server/processing/audio_rms.py`):**
```python
def rms(samples: list[float]) -> float:
    """Root mean square of amplitude samples."""

def rms_to_db(rms_value: float) -> float:
    """20 * log10(rms_value) + 100, clamp ke [0, 120]."""
```

### 8.4 Decision Engine (`server/processing/decision_engine.py`)
```python
from dataclasses import dataclass

@dataclass
class Context:
    time_label: str        # "jam_kuliah" | "waktu_sholat" | "jam_malam" | "lainnya"
    distance_kampus_m: float
    distance_masjid_m: float
    distance_kos_m: float
    distance_bar_m: float
    db_level: float
    claimed_at_kos: bool   # True jika koordinat GPS klaim berada di radius kos

def classify(ctx: Context) -> str:
    """Return salah satu status enum di Bagian 7.4, berdasarkan tabel keputusan di Bagian 8.5."""
```

### 8.5 Tabel Keputusan (acuan implementasi `classify()`)

| Waktu | Jarak | dB | Status |
|---|---|---|---|
| jam_kuliah | ≤150m kampus | <65 | `SEDANG_KULIAH` |
| jam_kuliah | >150m kampus | bebas | `ALERT_BOLOS_KULIAH` |
| waktu_sholat | >100m masjid | bebas | `WARNING_BELUM_KE_MASJID` |
| jam_malam | ≤50m kos | <55 | `ISTIRAHAT_DI_KOS` |
| jam_malam | ≤100m bar | >75 | `CRITICAL_TERDETEKSI_DI_BAR` |
| jam_malam | ≤50m kos (claimed_at_kos=true) | >80 | `ANOMALY_FAKE_GPS` |
| lainnya | - | - | `NORMAL` |

Urutan evaluasi: cek `ANOMALY_FAKE_GPS` lebih dulu sebelum `ISTIRAHAT_DI_KOS` (karena keduanya sama-sama "≤50m kos" tapi beda threshold dB - anomaly harus menang jika dB tinggi).

### 8.6 Server Main Loop (`server/main.py`)
Pseudocode:
```python
1. load_config()  # dari .env: PROJECT_ID, MQTT_HOST, MQTT_PORT, poi coordinates
2. connect_mqtt(), subscribe ke edge/anak/telemetry dan edge/ortu/telemetry
3. on_message(telemetry):
     simpan state terbaru per device_id
     jika ada data dari anak:
         hitung distance ke semua POI (haversine)
         hitung db_level dari payload
         tentukan time_label dari waktu sekarang
         status = classify(Context(...))
         jika status berubah dari status sebelumnya:
             publish ke topic alerts (payload sesuai 7.4)
```

### 8.7 Dashboard - Breakdown Komponen Next.js

**`hooks/useMqtt.ts`** - buka koneksi `mqtt.connect(wss://broker.hivemq.com:8884/mqtt)`, subscribe ke `edge/+/telemetry` dan `alerts`, expose `latestTelemetry`, `latestAlert`, `publishCommand(topic, payload)`.

**`hooks/useTelemetryStore.ts`** - simpan histori telemetry (array terbatas, misal 60 data terakhir) untuk dipakai `HistoryChart`.

**`components/MapPanel.tsx`** - `react-leaflet` dengan tile CartoDB dark, marker posisi anak (update live dari `useMqtt`), circle geofence untuk tiap POI di Bagian 7.6 dengan warna: masjid hijau, kampus & kos biru/cyan, bar merah.

**`components/AudioVisualizer.tsx`** - bar animasi berdasarkan `db` terbaru, dengan label kategori (`Hening < 55`, `Normal 55-75`, `Bising > 75`).

**`components/StatusCard.tsx`** - tampilkan `status` dari alert terbaru, warna background berbeda per status (merah untuk CRITICAL/ANOMALY, kuning WARNING/ALERT, hijau NORMAL/AMAN).

**`components/CommandCenter.tsx`** - 3 tombol yang publish ke `command/alarm`, `command/reminder`, `command/ping`.

**`components/DemoPresetPanel.tsx`** - dropdown/tombol preset jam (`09:00 Kuliah`, `12:00 Dzuhur`, `23:30 Malam`) + tombol pindah titik simulasi lokasi (kampus/masjid/kos/bar), yang saat ditekan mem-publish telemetry palsu langsung ke broker (untuk testing tanpa HP fisik / sebagai cadangan demo).

**`components/HistoryChart.tsx`** - `recharts` line chart: jarak ke POI terdekat & dB, dari `useTelemetryStore`.

**`lib/types.ts`** - definisikan TypeScript interface persis sesuai skema JSON Bagian 7.2-7.5, contoh:
```typescript
export interface AnakTelemetry {
  device_id: "anak";
  sequence: number;
  sent_at_ms: number;
  location: { lat: number; lon: number; accuracy_m: number };
  audio: { rms: number; db: number };
  motion: { accel_magnitude: number };
}

export type AlertStatus =
  | "SEDANG_KULIAH" | "ALERT_BOLOS_KULIAH" | "WARNING_BELUM_KE_MASJID"
  | "ISTIRAHAT_DI_KOS" | "CRITICAL_TERDETEKSI_DI_BAR" | "ANOMALY_FAKE_GPS" | "NORMAL";

export interface Alert {
  status: AlertStatus;
  reason: string;
  timestamp_ms: number;
  context: { time_label: string; nearest_poi: string; distance_m: number; db: number };
}
```

## 9. Strategi Mock Data (supaya 3 modul bisa dikerjakan paralel)

Sebelum integrasi, setiap modul dites independen dengan data palsu:
- **Dashboard**: buat file `dashboard/lib/mockData.ts` berisi contoh `AnakTelemetry` dan `Alert` sesuai skema di atas, dipakai sementara `useMqtt` belum terhubung ke server asli (toggle via env var `NEXT_PUBLIC_USE_MOCK=true`).
- **Server**: `server/tests/` berisi unit test dengan payload dummy sesuai skema 7.2/7.3, tidak butuh HP fisik untuk memverifikasi `haversine`, `rms_to_db`, `classify`.
- **Edge**: bisa dites dengan `mosquitto_pub` manual (lihat contoh dosen) untuk mengirim payload sesuai skema 7.2/7.3 sebelum sensor asli terpasang.

## 10. Pembagian Tugas (3 Orang)

### 👤 Anggota 1 - Edge Device Lead
- Folder: `dashboard/app/anak/`, `dashboard/app/ortu/` (dan fallback `edge/`). Branch prefix: `edge/`.
- Implementasi Geolocation API, Web Audio API (RMS→dB di sisi client untuk validasi), DeviceMotion untuk shake detection.
- Publish/subscribe MQTT sesuai kontrak Bagian 7.2/7.3/7.5.
- UI mobile modern responsif di HP: status koneksi, gauge sensor, notifikasi alert masuk, tombol manual darurat.

### 👤 Anggota 2 - Backend Processing & Algoritma Lead
- Folder: `server/`. Branch prefix: `server/`.
- Implementasi `haversine.py`, `audio_rms.py`, `decision_engine.py`, `mqtt_client.py`, `main.py` sesuai Bagian 8.3-8.6.
- Unit test untuk tiap fungsi processing (`server/tests/`).
- Jaga konsistensi skema payload - review PR dari edge & dashboard untuk hal ini.

### 👤 Anggota 3 - **Dashboard Lead (fokus "gokil", Next.js)**
- Folder: `dashboard/app/page.tsx` & `dashboard/components/`. Branch prefix: `dashboard/`.
- Setup project Next.js + Tailwind + react-leaflet + recharts + mqtt (Hosting Vercel).
- Bangun semua komponen di Bagian 8.7, styling dark theme, animasi smooth.
- Buat `DemoPresetPanel` jadi senjata utama saat presentasi (bisa jalan tanpa HP fisik).

> Dokumentasi PPT, video demo, dan `README.md` utama dikerjakan bersama di H-1, masing-masing menulis bagian modulnya sendiri.

## 11. Timeline (1 Minggu)

| Hari | Target |
|---|---|
| 1 | Setup repo + branching, isi `docs/mqtt-schema.md`, setup broker & `.env.example`, inisialisasi Next.js project + deploy Vercel |
| 2-3 | Edge publish telemetry dummy → Server subscribe & proses (Haversine, dB) jalan dengan mock |
| 3-4 | Decision engine lengkap + unit test lulus; Dashboard komponen utama (Map, StatusCard) render dengan mock data |
| 4-5 | Integrasi nyata: Edge asli via HP Vercel → Server → Dashboard (ganti mock jadi data live) |
| 6 | DemoPresetPanel, Command Center, testing semua skenario di Bagian 12, merge `develop` → `main` |
| 7 | Rekam video demo, susun PPT, finalisasi README |

## 12. Kriteria Sukses / Demo Checklist

- [ ] `SEDANG_KULIAH` terdeteksi saat HP dekat kampus & tenang
- [ ] `ALERT_BOLOS_KULIAH` saat HP jauh dari kampus di jam kuliah
- [ ] `CRITICAL_TERDETEKSI_DI_BAR` saat dB tinggi + dekat bar malam hari
- [ ] `ANOMALY_FAKE_GPS` saat lokasi klaim kos tapi dB tinggi
- [ ] Shake-to-ping dari HP ortu memicu respons di HP anak
- [ ] Dashboard Next.js menampilkan peta, visualizer, status live tanpa delay signifikan
- [ ] DemoPresetPanel bisa mensimulasikan seluruh skenario tanpa jalan kaki fisik
- [ ] Semua perangkat terhubung via internet HTTPS Vercel & broker publik HiveMQ (bebas dari provider manapun, tidak terikat 1 WiFi lokal)
- [ ] `develop` sudah di-merge ke `main`, tidak ada konflik tersisa

## 13. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Tidak bisa jalan ke lokasi asli saat demo di kelas | DemoPresetPanel (simulasi jam + koordinat via MQTT publish langsung) |
| Mikrofon HP beda sensitivitas antar perangkat | Kalibrasi threshold dB saat testing H-4/H-5 |
| Broker publik down/delay saat presentasi | Siapkan broker cadangan (EMQX) di `.env`, tes H-5 |
| Konflik merge antar branch (skema payload beda) | Kontrak Bagian 7 adalah sumber kebenaran tunggal - review PR wajib cek ini |
| iPhone/Android browser restriksi Web Audio/Geolocation | **Mitigasi Selesai:** Hosting Vercel menyediakan domain HTTPS resmi otomatis, izin sensor langsung disetujui browser smartphone tanpa diblokir |

## 14. Deliverables

1. Kode di GitHub (monorepo, struktur sesuai Bagian 5, histori branch bisa dilihat)
2. PPT dokumentasi: masalah & ide, arsitektur, sensor, processing & algoritma, cloud, pengujian
3. Video demo end-to-end (termasuk skenario `ANOMALY_FAKE_GPS` sebagai fitur pembeda)
