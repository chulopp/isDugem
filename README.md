# 🛡️ RantauGuard (isDugem)
### Smart Student & Parental Guardian System — IoT Multicommunication 2 Arah & Multisensor

[![Status](https://img.shields.io/badge/Status-Active%20Development-blue.svg)](#)
[![Python Tests](https://img.shields.io/badge/Python%20Tests-16%20Passed-brightgreen.svg)](#)
[![Stack](https://img.shields.io/badge/Stack-Python%20%7C%20Next.js%20%7C%20Web%20Sensors%20%7C%20MQTT-orange.svg)](#)

RantauGuard adalah sistem IoT pemantau mahasiswa rantau terintegrasi dengan validasi **multisensor** (GPS + Mikrofon Suasana Sekitar + Akselerometer) dan **komunikasi dua arah** berbasis protokol MQTT. Sistem ini mampu mendeteksi manipulasi lokasi (*Fake GPS*) melalui verifikasi silang antara koordinat klaim dengan intensitas kebisingan suara ruangan.

---

## 📌 Daftar Isi
1. [Arsitektur & Alur Sistem](#-arsitektur--alur-sistem)
2. [Pembagian Tugas Tim (3 Orang)](#-pembagian-tugas-tim-3-orang)
3. [Alur Kerja Git & Kolaborasi Tim (Wajib Dipatuhi)](#-alur-kerja-git--kolaborasi-tim-wajib-dipatuhi)
4. [Struktur Folder Monorepo](#-struktur-folder-monorepo)
5. [Panduan Menjalankan Modul (Quickstart)](#-panduan-menjalankan-modul-quickstart)
6. [Kontrak Komunikasi & Broker MQTT](#-kontrak-komunikasi--broker-mqtt)
7. [Checklist Skenario Demo](#-checklist-skenario-demo)

---

## 🏗️ Arsitektur & Alur Sistem

```mermaid
flowchart LR
    subgraph EdgeDevices["Edge Devices (Smartphone Web App)"]
        EA["Edge HP Anak\n(GPS + Mic + Accel)"]
        EO["Edge HP Ortu\n(Shake Sensor + Remote)"]
    end

    subgraph CloudBroker["Cloud Broker (HiveMQ)"]
        MQTT["broker.hivemq.com\nPort 8883 (TLS) & 8884 (WSS)"]
    end

    subgraph Backend["Server Processing (Python)"]
        PROC["Data Processing:\n- Haversine Distance\n- Audio RMS -> dB\n- Decision Engine Classifier"]
    end

    subgraph Monitoring["Command Center (Laptop Ortu)"]
        DASH["Dashboard Next.js 14\n- Live Dark Map & Geofence\n- Audio Visualizer\n- Anomaly & Status Alert\n- Demo Preset Simulator"]
    end

    EA -->|"telemetry (GPS, dB, Accel)"| MQTT
    EO -->|"shake-to-ping & commands"| MQTT
    MQTT -->|"consume raw telemetry"| PROC
    PROC -->|"publish classified alerts"| MQTT
    MQTT -->|"alerts & status live stream"| DASH
    MQTT -.->|"command/alarm/reminder/ping"| EA
```

---

## 👥 Pembagian Tugas Tim (3 Orang)

Setiap anggota memiliki area tanggung jawab folder masing-masing untuk mencegah tabrakan kode (*merge conflict*):

| Anggota | Peran | Folder Tanggung Jawab | Prefix Branch |
|---|---|---|---|
| **Anggota 1** | **Edge Device Lead** | `edge/anak/`, `edge/ortu/` | `edge/*` |
| **Anggota 2** | **Backend Processing & Algoritma Lead** | `server/` | `server/*` |
| **Anggota 3** | **Dashboard Lead (Next.js)** | `dashboard/` | `dashboard/*` |

---

## 🌿 Alur Kerja Git & Kolaborasi Tim (Wajib Dipatuhi)

Untuk memastikan proyek selesai rapi, terintegrasi, dan tidak ada file yang rusak menjelang deadline, ikuti aturan Git berikut:

### 1. Struktur Cabang (Branching Model)
- `main` : Cabang stabil (*production ready*). **Dilarang langsung push ke `main`**. Cabang ini hanya di-merge dari `develop` saat rilis demo final.
- `develop` : Cabang integrasi utama. Tempat seluruh fitur tim digabungkan dan diuji bersama.
- Cabang Fitur Pribadi : Dibuat bercabang dari `develop` dengan prefix nama modul masing-masing.

### 2. Standar Nama Branch
- Modul Edge: `edge/anak-baca-gps`, `edge/ortu-shake-detect`
- Modul Server: `server/formula-haversine`, `server/decision-engine`
- Modul Dashboard: `dashboard/map-leaflet`, `dashboard/command-center`

### 3. Standar Pesan Commit (Conventional Commits)
Gunakan format: `<tipe>(<modul>): <deskripsi singkat>`
- `feat(edge-anak): tambah pembacaan mic web audio api`
- `fix(server): perbaiki pembagian nol pada audio rms`
- `feat(dashboard): integrasi websocket mqtt ke status card`
- `test(server): tambah unit test untuk kondisi anomaly fake gps`
- `docs(readme): perbarui langkah instalasi lokal`

---

### 4. Langkah Step-by-Step Mengerjakan Fitur (Panduan untuk Teman Tim)

#### Langkah 1: Clone dan Sinkronisasi Awal
```bash
git clone https://github.com/chulopp/isDugem.git
cd isDugem

# Pindah ke branch integrasi develop
git checkout develop
git pull origin develop
```

#### Langkah 2: Buat Branch Fitur Baru
```bash
# Contoh untuk Anggota 1 yang mengerjakan sensor anak:
git checkout -b edge/anak-sensor-capture

# Contoh untuk Anggota 2 yang mengerjakan server:
git checkout -b server/koneksi-mqtt-processing
```

#### Langkah 3: Kerjakan Fitur & Uji Secara Mandiri
> ⚠️ **PENTING:** Kerjakan kode **HANYA** di folder modul Anda sendiri (`edge/`, `server/`, atau `dashboard/`). Jangan mengedit file di folder modul rekan Anda kecuali telah disepakati bersama.

#### Langkah 4: Commit dan Push ke GitHub
```bash
# Periksa file yang diubah
git status

# Tambahkan perubahan dan commit
git add .
git commit -m "feat(edge-anak): implementasi pengiriman payload telemetri"

# Push branch fitur ke GitHub
git push -u origin edge/anak-sensor-capture
```

#### Langkah 5: Buka Pull Request (PR) ke `develop`
1. Buka repository di browser: [https://github.com/chulopp/isDugem](https://github.com/chulopp/isDugem)
2. Klik tombol **"Compare & pull request"**.
3. **PENTING:** Pastikan arah merge:
   - `base: develop` ⬅️ `compare: branch-fitur-anda`
   - *(JANGAN jadikan base ke `main`!)*
4. Isi checklist pada template PR yang otomatis muncul:
   - [x] Kontrak data MQTT cocok dengan `docs/mqtt-schema.md`
   - [x] Tidak ada `.env` yang ter-commit
   - [x] Sudah diuji secara mandiri
5. Minta minimal **1 rekan kelompok** untuk melakukan *Review & Approve*.
6. Setelah di-approve, branch dapat di-merge ke `develop`.

---

## 📁 Struktur Folder Monorepo

```
isDugem/
├── .github/
│   └── PULL_REQUEST_TEMPLATE.md       # Template PR otomatis dengan checklist kontrak
├── .gitignore                         # Mengabaikan file env, venv, cache, node_modules
├── .env.example                       # Referensi variabel lingkungan global
├── README.md                          # Panduan tim utama
├── docs/
│   ├── prd.md                         # Product Requirement Document (PRD v2)
│   ├── mqtt-schema.md                 # KONTRAK DATA: Topik, Payload JSON, POI, Enum
│   └── demo-script.md                 # Skenario pengujian & langkah demonstrasi kelas
├── edge/                              # Tanggung jawab: Anggota 1
│   ├── anak/                          # Web app sensor HP anak (GPS, Audio dB, Accel)
│   └── ortu/                          # Web app HP ortu (Shake-to-ping & remote)
├── server/                            # Tanggung jawab: Anggota 2
│   ├── requirements.txt               # paho-mqtt, python-dotenv, pytest
│   ├── config.py                      # Loader environment & koordinat POI
│   ├── models.py                      # Dataclass Telemetry, Context, Alert
│   ├── mqtt_client.py                 # Klien MQTT HiveMQ TLS
│   ├── main.py                        # Server main loop (Subscribe -> Process -> Publish)
│   ├── processing/                    # Algoritma: Haversine, Audio RMS, Decision Engine
│   └── tests/                         # Unit tests pytest (16 tests lulus)
└── dashboard/                         # Tanggung jawab: Anggota 3
    ├── .env.local.example             # Konfigurasi Next.js WebSocket
    └── README.md                      # Petunjuk setup & arsitektur UI Next.js
```

---

## 🚀 Panduan Menjalankan Modul (Quickstart)

### 1. Modul Server Backend Python (`server/`)
1. Masuk ke folder server dan buat *virtual environment*:
   ```bash
   cd server
   python -m venv venv
   
   # Aktivasi (Windows PowerShell)
   .\venv\Scripts\Activate.ps1
   # Aktivasi (Linux/Mac)
   source venv/bin/activate
   ```
2. Pasang dependensi:
   ```bash
   pip install -r requirements.txt
   ```
3. Jalankan pengujian unit test:
   ```bash
   pytest
   ```
   *(Pastikan seluruh 16 pengujian lulus hijau!)*
4. Jalankan server:
   ```bash
   python main.py
   ```

---

### 2. Modul Edge Device HP (`edge/anak/` & `edge/ortu/`)
1. Salin konfigurasi:
   ```bash
   cd edge/anak
   cp config.example.js config.js
   ```
2. Buka folder menggunakan extension **Live Server** di VS Code atau server lokal statis (misal: `npx serve .`).
3. Buka URL dari browser smartphone yang berada dalam satu jaringan WiFi.
4. Klik tombol **"Mulai Sensor & Telemetri"** dan berikan izin akses Lokasi & Mikrofon.

---

### 3. Modul Dashboard Next.js (`dashboard/`)
1. Masuk ke folder dashboard:
   ```bash
   cd dashboard
   cp .env.local.example .env.local
   ```
2. Jalankan server pengembang:
   ```bash
   npm run dev
   ```
3. Buka di browser: [http://localhost:3000](http://localhost:3000).

---

## 📡 Kontrak Komunikasi & Broker MQTT

> ⚠️ **PERHATIAN KERAS KEPADA SELURUH ANGGOTA:**
> Jangan pernah mengubah nama field JSON atau nama topik MQTT tanpa memperbarui dokumen `docs/mqtt-schema.md`! Ketiga modul saling bergantung pada kontrak ini.

- **Broker Publik:** `broker.hivemq.com`
- **Port Edge & Server:** `8883` (MQTTS over TLS)
- **Port Dashboard:** `8884` (MQTT over Secure WebSocket: `wss://broker.hivemq.com:8884/mqtt`)
- **Prefix Topik (`PROJECT_ID`):** `isdugem_tim_01` (dapat disesuaikan di `.env`)

Dokumentasi lengkap payload dapat dibaca di:  
👉 **[docs/mqtt-schema.md](file:///d:/Fallah's%20File/Code/Personal%20Project/isDugem/docs/mqtt-schema.md)**

---

## 🎬 Checklist Skenario Demo

Sebelum presentasi di hadapan dosen, pastikan seluruh skenario ini berjalan lancar:
- [x] **Unit Testing Server:** 16 pengujian pytest lulus 100%.
- [ ] **Skenario Normal Kuliah:** Status `SEDANG_KULIAH` muncul saat HP di area kampus dengan audio tenang.
- [ ] **Skenario Bolos:** Status `ALERT_BOLOS_KULIAH` aktif saat HP menjauh di jam perkuliahan.
- [ ] **Skenario Pengingat Sholat:** Status `WARNING_BELUM_KE_MASJID` dan tombol reminder mengirim getar ke HP anak.
- [ ] **Skenario Terdeteksi Bar:** Status `CRITICAL_TERDETEKSI_DI_BAR` aktif jika dekat bar di jam malam dengan dB > 75.
- [ ] **Skenario Anomaly Fake GPS (Andalan):** Status `ANOMALY_FAKE_GPS` aktif saat koordinat berada di kos tetapi mikrofon mendeteksi suara dentuman > 80 dB!
- [ ] **Komunikasi 2 Arah:** Goyangkan HP Ortu (*shake*) memicu getar dan alert seketika pada HP Anak.

Skrip lengkap pengujian dapat dibaca di:  
👉 **[docs/demo-script.md](file:///d:/Fallah's%20File/Code/Personal%20Project/isDugem/docs/demo-script.md)**
