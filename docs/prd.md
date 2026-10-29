# PRD - isDugem (RantauGuard)
### Smart Student & Parental Guardian System
**Mata Kuliah:** Internet of Things - Tugas Praktek Multicommunication 2 Arah & Multisensor
**Tim:** 3 orang &bull; **Versi dokumen:** v2.2 - Final Production Alignment (Next.js App Router, 2 Sensor HP Ortu & Python Decision Engine)

---

## 0. Cara Pakai Dokumen Ini

Dokumen ini ditulis sebagai panduan spesifikasi dan acuan arsitektur sistem. Setiap modul memiliki tanggung jawab, struktur folder, kontrak data (skema persis), dan definisi fungsi yang terkoordinasi. Nama topik MQTT dan struktur field JSON pada dokumen ini diselaraskan sepenuhnya dengan implementasi nyata pada server, edge, dan dashboard.

---

## 1. Latar Belakang & Masalah

Mahasiswa rantau sering sulit dipantau orang tua: pemantauan lokasi berbasis GPS konvensional rentan terhadap manipulasi (*fake GPS*), seolah-olah berada di kos atau masjid padahal sedang berada di lokasi hiburan malam. Kombinasi **lokasi (GPS)** dan **suasana suara sekitar (mikrofon)** saling memvalidasi: koordinat GPS dapat dimanipulasi, namun suasana kebisingan suara lingkungan (hening ruang kos vs dentuman musik klub malam) tidak dapat dipalsukan secara bersamaan.

---

## 2. Tujuan Produk

1. Verifikasi otomatis lokasi dan suasana lingkungan anak secara real-time untuk orang tua.
2. Deteksi anomali (klaim lokasi GPS berada di kos namun kebisingan suara sekitar tinggi pada jam malam, indikasi kuat *Fake GPS*).
3. Komunikasi dua arah: anak ke ortu (telemetri sensor dan peringatan status), ortu ke anak (perintah getar ping, alarm darurat, pengingat ibadah/kuliah, dan pengiriman koordinat GPS ortu).
4. Memenuhi 100% ketentuan tugas mata kuliah IoT dengan keunggulan pada aspek ide orisinalitas, pengolahan data multisensor, algoritma klasifikasi keputusan, dan dashboard visual real-time.

---

## 3. Pemetaan ke Ketentuan Tugas

| # | Ketentuan Tugas | Pemenuhan |
|---|---|---|
| 1 | Kelompok 3-4 orang | Tim 3 orang (Fallah, Raditya, Wendi - Bagian 10) |
| 2 | Min. 2 edge device, min. 2 sensor per device | Edge 1 = HP Anak (3 Sensor: GPS + Mikrofon dB + Akselerometer); Edge 2 = HP Ortu (2 Sensor: GPS Geolocation + Akselerometer Shake-to-Ping) |
| 3 | Min. 2 data processing | 1) Haversine distance geofencing; 2) Konversi Audio RMS ke skala desibel (dB) |
| 4 | Algoritma AI / Machine Learning / Rule-Based | Context-Aware Fusion Decision Table (rule-based classifier 7 status) |
| 5 | Min. 1 protokol ke cloud | MQTT over TLS port 8883 (Backend Python) & WSS port 8884 (Browser Web) via HiveMQ publik |
| 6 | Dashboard visualisasi | Dashboard Next.js 14 App Router dengan peta interaktif Leaflet, indikator audio, riwayat histori, dan kontrol perintah |
| 7 | Ide orisinalitas | Verifikasi silang Geofence + Desibel Suara untuk pencegahan manipulasi lokasi Fake GPS |

---

## 4. Arsitektur Teknologi & Deployment

| Modul | Stack | Alasan |
|---|---|---|
| Edge Devices (Anak & Ortu) | **Next.js App Router Client Pages (`/anak`, `/ortu`)** (Geolocation API + Web Audio API + DeviceMotion API) dengan fallback file statis di `edge/` | Berjalan langsung di peramban ponsel melalui HTTPS resmi Vercel, bebas hambatan izin sensor, akses via QR code tanpa instalasi APK |
| Backend Processing | **Python 3.11+**, `paho-mqtt`, `python-dotenv` | Layanan independen pemrosesan matematis Haversine, konversi RMS ke desibel, dan evaluasi mesin keputusan |
| Dashboard Pemantauan | **Next.js 14 (App Router) + TypeScript + Tailwind CSS** di rute utama `/` | Antarmuka pusat kendali modern: peta pelacakan live Leaflet, indikator KPI, grafik time-series, log kejadian, dan simulator skenario |
| Cloud Hosting Web | **Vercel** (Production HTTPS Deployment) | Menyediakan domain HTTPS otomatis (`https://isdugem.vercel.app/`) untuk akses sensor mikrofon dan GPS tanpa hambatan browser |
| Broker Pesan | **HiveMQ Cloud** (`broker.hivemq.com`) | Broker MQTT publik andal: port 8883 (MQTTS TLS) untuk Python server dan port 8884 (WebSocket WSS) untuk browser web |

---

## 5. Struktur Repositori (Monorepo)

```
isDugem/
├── README.md                       # Dokumentasi akademik utama
├── .gitignore
├── .env.example                    # Referensi environment global
├── docs/
│   ├── prd.md                      # Dokumen PRD spesifikasi sistem
│   ├── mqtt-schema.md              # Kontrak data dan skema MQTT
│   └── demo-script.md              # Skenario dan skrip pengujian demo
├── edge/                           # Implementasi standalone fallback (HTML/JS statis)
│   ├── anak/
│   │   ├── index.html
│   │   ├── app.js
│   │   └── style.css
│   └── ortu/
│       ├── index.html
│       ├── app.js
│       └── style.css
├── server/                         # Backend decision engine (Python 3.11)
│   ├── requirements.txt
│   ├── .env.example
│   ├── config.py
│   ├── mqtt_client.py
│   ├── processing/
│   │   ├── __init__.py
│   │   ├── haversine.py
│   │   ├── audio_rms.py
│   │   └── decision_engine.py
│   ├── models.py                   # Data class Telemetry, Alert, Context
│   ├── main.py                     # Entrypoint server MQTT
│   └── tests/                      # Unit test Pytest (169 lulus)
└── dashboard/                      # Aplikasi Next.js 14 App Router (Hosting Vercel)
    ├── package.json
    ├── tsconfig.json
    ├── tailwind.config.ts
    ├── .env.local.example
    ├── app/
    │   ├── layout.tsx
    │   ├── globals.css
    │   ├── page.tsx                # Rute Utama: Dashboard Pemantauan
    │   ├── anak/page.tsx           # Rute HP Anak: Sensor GPS, Audio dB, Akselerometer
    │   └── ortu/page.tsx           # Rute HP Ortu: GPS Live, Shake-to-Ping, Remote Action
    ├── components/
    │   ├── MapPanel.tsx            # Kontainer panel peta dan rute jalan
    │   ├── LeafletMapInner.tsx     # Rendering peta Leaflet, geofence, marker anak dan ortu
    │   ├── KpiStrip.tsx            # Strip 3 kartu metrik status, suara, dan kecepatan
    │   ├── SystemControlPanel.tsx  # Kontrol perintah remote, status ortu, dan log kejadian
    │   ├── DemoPresetPanel.tsx     # Panel simulator skenario pengujian demo
    │   ├── HistoryChart.tsx        # Grafik riwayat desibel dan jarak POI
    │   ├── Sidebar.tsx             # Navigasi tab dan status broker
    │   └── QrConnectModal.tsx      # Modal scan QR code akses cepat HP Anak dan Ortu
    ├── hooks/
    │   ├── useMqtt.ts              # Hook koneksi WebSocket WSS MQTT
    │   └── useTelemetryStore.ts    # State management telemetri, jejak rute, dan event
    ├── lib/
    │   ├── mqttTopics.ts           # Konstanta topik, koordinat POI, dan kalkulasi jarak
    │   ├── types.ts                # Definisi tipe data TypeScript
    │   └── mockData.ts             # Data simulasi jalan dan helper timestamp
    └── public/                     # Aset statis: logo, ikon, favicon
```

---

## 6. Kontrak Data MQTT (Sumber Kebenaran Tunggal)

**Broker Host:** `broker.hivemq.com`
**Port Python Server:** `8883` (MQTTS over TLS)
**Port Browser Web:** `8884` (WSS over TLS) -> `wss://broker.hivemq.com:8884/mqtt`
**Prefix Topik (`PROJECT_ID`):** `isdugem_tim_01` (dikonfigurasi via environment variable).

### 6.1 Daftar Topik

| Topik | Publisher | Subscriber | QoS | Keterangan |
|---|---|---|---|---|
| `rantauguard/{PROJECT_ID}/edge/anak/telemetry` | Edge Anak, Dashboard | Server, Edge Ortu, Dashboard | 1 | Telemetri 3 sensor berkala (GPS, audio dB, akselerometer) setiap 1 detik |
| `rantauguard/{PROJECT_ID}/edge/ortu/telemetry` | Edge Ortu | Server, Edge Anak, Dashboard | 1 | Telemetri 2 sensor berkala (GPS live dan akselerometer shake) setiap 1.5 detik |
| `rantauguard/{PROJECT_ID}/alerts` | Server | Edge Anak, Edge Ortu, Dashboard | 1 | Hasil klasifikasi keputusan status dari backend (retained) |
| `rantauguard/{PROJECT_ID}/command/ping` | Edge Ortu, Dashboard | Edge Anak, Server, Dashboard | 1 | Perintah cek status dan getar HP anak |
| `rantauguard/{PROJECT_ID}/command/alarm` | Edge Ortu, Dashboard | Edge Anak, Dashboard | 1 | Perintah sirine alarm bahaya di HP anak |
| `rantauguard/{PROJECT_ID}/command/reminder` | Edge Ortu, Dashboard | Edge Anak, Dashboard | 1 | Perintah pengingat ibadah atau kuliah di HP anak |
| `rantauguard/{PROJECT_ID}/command/timemode` | Edge Anak, Dashboard | Edge Anak, Dashboard | 1 | Sinkronisasi simulasi waktu dan kunci lokasi demo dua arah |

### 6.2 Spesifikasi Payload Telemetri Anak (`edge/anak/telemetry`)
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

### 6.3 Spesifikasi Payload Telemetri Ortu (`edge/ortu/telemetry`)
```json
{
  "device_id": "ortu",
  "sequence": 17,
  "sent_at_ms": 1790000000000,
  "location": {
    "lat": -7.0540,
    "lon": 110.4380,
    "accuracy_m": 8.0
  },
  "motion": {
    "accel_magnitude": 9.8,
    "shake_detected": false
  }
}
```

### 6.4 Spesifikasi Payload Peringatan Backend (`alerts`)
```json
{
  "status": "CRITICAL_TERDETEKSI_DI_BAR",
  "reason": "Jarak ke bar 42m, suara 81.3 dB pada jam 23:10",
  "timestamp_ms": 1790000000000,
  "context": {
    "time_label": "jam_malam",
    "nearest_poi": "bar",
    "distance_m": 42.0,
    "db": 81.3
  }
}
```

Status resmi keputusan:
- `SEDANG_KULIAH`
- `ALERT_BOLOS_KULIAH`
- `WARNING_BELUM_KE_MASJID`
- `ISTIRAHAT_DI_KOS`
- `CRITICAL_TERDETEKSI_DI_BAR`
- `ANOMALY_FAKE_GPS`
- `NORMAL`

### 6.5 Titik Geofence POI (Point of Interest)
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
      { "name": "RedHare Semarang", "lat": -6.968000, "lon": 110.428500 },
      { "name": "Marabunta Kota Lama", "lat": -6.966445, "lon": 110.430036 },
      { "name": "Golden Tiger Semarang", "lat": -6.966984, "lon": 110.429807 },
      { "name": "HW Tiger Club Semarang", "lat": -6.965717, "lon": 110.429464 }
    ]
  }
}
```

---

## 7. Logika Tabel Keputusan (Decision Engine Matrix)

| Konteks Waktu | Syarat Jarak POI | Syarat Suara (dB) | Status Keputusan | Deskripsi Status |
|---|---|---|---|---|
| **Jam Kuliah** (08:00 - 15:00 WIB) | Jarak ke Kampus <= 150 m | Suara tenang (< 65 dB) | `SEDANG_KULIAH` | Mahasiswa berada di area kampus dalam suasana kelas kondusif. |
| **Jam Kuliah** (08:00 - 15:00 WIB) | Jarak ke Kampus > 150 m | Bebas | `ALERT_BOLOS_KULIAH` | Mahasiswa berada di luar area kampus saat jam perkuliahan berlangsung. |
| **Waktu Sholat** (Jadwal Sholat Wajib) | Jarak ke Masjid > 100 m | Bebas | `WARNING_BELUM_KE_MASJID` | Pengingat waktu sholat aktif saat mahasiswa berada jauh dari masjid kampus. |
| **Jam Malam** (22:00 - 05:00 WIB) | Jarak ke Kos <= 750 m (Klaim) | Suara bising (> 80 dB) | `ANOMALY_FAKE_GPS` | Terdeteksi indikasi manipulasi lokasi: klaim GPS di kos tetapi audio menangkap kebisingan tinggi. |
| **Jam Malam** (22:00 - 05:00 WIB) | Jarak ke Bar <= 250 m | Suara bising (> 75 dB) | `CRITICAL_TERDETEKSI_DI_BAR` | Mahasiswa terdeteksi berada di lokasi hiburan malam pada jam rawan. |
| **Jam Malam** (22:00 - 05:00 WIB) | Jarak ke Kos <= 750 m | Suara tenang (< 55 dB) | `ISTIRAHAT_DI_KOS` | Mahasiswa berada di area kos dalam keadaan tenang dan beristirahat. |
| **Semua Waktu** | Di luar kondisi batas | Sesuai kondisi | `NORMAL` | Aktivitas harian normal di luar parameter anomali risiko. |

*Urutan evaluasi prioritas:* Pada `jam_malam`, aturan `ANOMALY_FAKE_GPS` dievaluasi terlebih dahulu sebelum `ISTIRAHAT_DI_KOS` untuk mencegah lolosnya manipulasi Fake GPS.

---

## 8. Pembagian Peran dan Tanggung Jawab Tim

| Nama Lengkap | NIM | Peran Utama | Tanggung Jawab Spesifik |
|---|---|---|---|
| **Fallah Iqbal Kurnianto** | `24060125130065` | **Pengembang Dashboard** | Arsitektur UI/UX Dashboard Next.js 14, integrasi Leaflet map, visualisasi data suara, panel simulasi preset, hook MQTT browser, dan manajemen deployment Vercel. |
| **Raditya Arganta Anantio** | `24060125120021` | **Pengembang Backend & Algoritma** | Perancangan Server Decision Engine Python 3.11, implementasi formula matematis Haversine geofence, konversi RMS audio ke desibel, dan pengujian unit otomatis Pytest (169 skenario). |
| **Wendi Adi Ardiansah** | `24060125120027` | **Pengembang Edge Device** | Pengembangan modul web HP Anak (3 sensor: GPS, Web Audio API, akselerometer) dan HP Orang Tua (2 sensor: GPS live, akselerometer Shake-to-Ping), serta optimasi pengiriman telemetri MQTT. |

---

## 9. Skenario Pengujian Demonstrasi (Demo Checklist)

- [x] **Skenario 1 (Kuliah Normal):** HP Anak dekat kampus (<= 150 m) dengan suara tenang (< 65 dB) menghasilkan status `SEDANG_KULIAH`.
- [x] **Skenario 2 (Bolos Kuliah):** HP Anak berada di luar radius kampus (> 150 m) saat jam kuliah menghasilkan status `ALERT_BOLOS_KULIAH`.
- [x] **Skenario 3 (Pengingat Sholat):** HP Anak berada di luar radius masjid (> 100 m) saat waktu sholat menghasilkan status `WARNING_BELUM_KE_MASJID`.
- [x] **Skenario 4 (Deteksi Bar Malam Hari):** HP Anak dekat bar (<= 250 m) dengan suara bising (> 75 dB) pada jam malam menghasilkan status `CRITICAL_TERDETEKSI_DI_BAR`.
- [x] **Skenario 5 (Fitur Pembeda Anomali Fake GPS):** HP Anak mengklaim lokasi di kos (<= 750 m) namun mikrofon mendeteksi suara > 80 dB menghasilkan status `ANOMALY_FAKE_GPS`.
- [x] **Skenario 6 (Sensor Ganda Ortu & Shake-to-Ping):** HP Ortu membaca koordinat GPS live yang tampil di HP Anak dan peta Dashboard, serta mendeteksi guncangan (> 18 m/s²) untuk memicu perintah ping getar ke HP Anak secara langsung.
