# Kontrak Data & Skema MQTT (Single Source of Truth)

Dokumen ini adalah **sumber kebenaran tunggal** untuk protokol komunikasi antar-modul pada proyek **RantauGuard (isDugem)**.
Semua modul (`edge`, `server`, dan `dashboard`) **WAJIB** mengikuti nama topik, tipe data, dan format payload JSON yang ada di sini tanpa modifikasi sepihak.

---

## 1. Konfigurasi Broker

- **Host Broker:** `broker.hivemq.com`
- **Port TLS (Edge & Server):** `8883` (MQTTS over TLS)
- **Port WSS (Dashboard Browser):** `8884` (MQTT over Secure WebSocket)
  - URL WSS: `wss://broker.hivemq.com:8884/mqtt`
- **Prefix Topik (`PROJECT_ID`):** Diambil dari variabel lingkungan (default: `isdugem_tim_01`).
  - Digunakan untuk mengisolasi topik agar tidak bertabrakan dengan pengguna lain di HiveMQ publik.

---

## 2. Daftar Topik & Alur Komunikasi

| Topik | Publisher | Subscriber | QoS | Keterangan |
|---|---|---|---|---|
| `rantauguard/{PROJECT_ID}/edge/anak/telemetry` | Edge Anak | Server | 1 | Telemetri sensor berkala (GPS, audio dB, accelerometer) setiap 2-3 detik |
| `rantauguard/{PROJECT_ID}/edge/ortu/telemetry` | Edge Ortu | Server | 1 | Telemetri posisi & status goyangan (shake) HP ortu |
| `rantauguard/{PROJECT_ID}/alerts` | Server | Edge Anak, Edge Ortu, Dashboard | 1 | Hasil klasifikasi status dan evaluasi aturan dari server |
| `rantauguard/{PROJECT_ID}/command/ping` | Edge Ortu, Dashboard | Edge Anak, Server | 1 | Perintah cek status / getar HP anak |
| `rantauguard/{PROJECT_ID}/command/alarm` | Dashboard | Edge Anak | 1 | Perintah bunyikan alarm darurat di HP anak |
| `rantauguard/{PROJECT_ID}/command/reminder` | Dashboard | Edge Anak | 1 | Perintah pengingat ibadah/kuliah di HP anak |

---

## 3. Spesifikasi Payload JSON

### 3.1 `rantauguard/{PROJECT_ID}/edge/anak/telemetry`
Dipublish oleh `edge/anak` secara berkala (tiap 2-3 detik):
```json
{
  "device_id": "anak",
  "sequence": 42,
  "sent_at_ms": 1790000000000,
  "location": {
    "lat": -6.9929,
    "lon": 110.4203,
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

### 3.2 `rantauguard/{PROJECT_ID}/edge/ortu/telemetry`
Dipublish oleh `edge/ortu` secara berkala atau saat terjadi event:
```json
{
  "device_id": "ortu",
  "sequence": 17,
  "sent_at_ms": 1790000000000,
  "location": {
    "lat": -6.9950,
    "lon": 110.4210
  },
  "motion": {
    "accel_magnitude": 9.8,
    "shake_detected": false
  }
}
```

### 3.3 `rantauguard/{PROJECT_ID}/alerts`
Dipublish oleh `server` setiap kali terjadi perubahan status klasifikasi atau kondisi anomali:
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

#### Nilai Enum `status` (Harus Sama Persis):
- `SEDANG_KULIAH`
- `ALERT_BOLOS_KULIAH`
- `WARNING_BELUM_KE_MASJID`
- `ISTIRAHAT_DI_KOS`
- `CRITICAL_TERDETEKSI_DI_BAR`
- `ANOMALY_FAKE_GPS`
- `NORMAL`

### 3.4 Command Payloads (`command/ping`, `command/alarm`, `command/reminder`)
```json
{
  "triggered_by": "ortu",
  "timestamp_ms": 1790000000000,
  "message": "Orang tua sedang mengecek posisi Anda!"
}
```

---

## 4. Titik Geofence POI (Point of Interest)

Titik koordinat referensi geofencing harus sama persis antara Server dan Dashboard (mencakup area UNDIP Tembalang hingga Semarang Bawah / Kota Lama):
```json
{
  "kampus": { "lat": -7.0502, "lon": 110.4398, "radius_m": 150 },
  "masjid": { "lat": -7.0552, "lon": 110.4370, "radius_m": 100 },
  "kos": {
    "lat": -7.0632,
    "lon": 110.4385,
    "radius_m": 750,
    "sub_points": [
      { "name": "Kos Mulawarman", "lat": -7.0612, "lon": 110.4338 },
      { "name": "Kos Gondang", "lat": -7.0562, "lon": 110.4402 },
      { "name": "Kos Banjarsari", "lat": -7.0558, "lon": 110.4368 }
    ]
  },
  "bar": {
    "lat": -6.966984,
    "lon": 110.429807,
    "radius_m": 250,
    "sub_points": [
      { "name": "RedHare Kota Lama", "lat": -6.9680, "lon": 110.4285 },
      { "name": "Marabunta Kota Lama", "lat": -6.9691, "lon": 110.4272 },
      { "name": "Golden Tiger Semarang", "lat": -7.0016, "lon": 110.4452 }
    ]
  }
}
```
*(Catatan: Koordinat dapat disesuaikan di file `.env` masing-masing modul sesuai area demo).*

---

## 5. Logika Tabel Keputusan (Decision Table)

| Waktu (`time_label`) | Jarak POI | Desibel (dB) | Status Klasifikasi |
|---|---|---|---|
| `jam_kuliah` | ≤ 150m kampus | < 65 dB | `SEDANG_KULIAH` |
| `jam_kuliah` | > 150m kampus | bebas | `ALERT_BOLOS_KULIAH` |
| `waktu_sholat` | > 100m masjid | bebas | `WARNING_BELUM_KE_MASJID` |
| `jam_malam` | ≤ 50m kos (`claimed_at_kos=true`) | > 80 dB | `ANOMALY_FAKE_GPS` (Prioritas Tinggi) |
| `jam_malam` | ≤ 50m kos | < 55 dB | `ISTIRAHAT_DI_KOS` |
| `jam_malam` | ≤ 100m bar | > 75 dB | `CRITICAL_TERDETEKSI_DI_BAR` |
| lainnya | - | - | `NORMAL` |
