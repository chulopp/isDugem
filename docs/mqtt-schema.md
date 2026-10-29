# Kontrak Data & Skema MQTT (Single Source of Truth)

Dokumen ini adalah **sumber kebenaran tunggal** untuk protokol komunikasi antar-modul pada proyek **isDugem (RantauGuard)**.
Semua modul (`edge`, `server`, dan `dashboard`) **WAJIB** mengikuti nama topik, tipe data, dan format payload JSON yang ada di sini tanpa modifikasi sepihak.

---

## 1. Konfigurasi Broker

- **Host Broker:** `broker.hivemq.com`
- **Port TLS (Edge & Server):** `8883` (MQTTS over TLS)
- **Port WSS (Dashboard & Edge PWA Browser):** `8884` (MQTT over Secure WebSocket)
  - URL WSS: `wss://broker.hivemq.com:8884/mqtt`
- **Prefix Topik (`PROJECT_ID`):** Diambil dari variabel lingkungan (default: `isdugem_tim_01`).
  - Digunakan untuk mengisolasi topik agar tidak bertabrakan dengan pengguna lain di HiveMQ publik.

---

## 2. Daftar Topik & Alur Komunikasi

| Topik | Publisher | Subscriber | QoS | Keterangan |
|---|---|---|---|---|
| `rantauguard/{PROJECT_ID}/edge/anak/telemetry` | Edge Anak, Dashboard | Server, Edge Ortu, Dashboard | 1 | Telemetri 3 sensor berkala (GPS, audio dB, accelerometer) setiap 1 detik |
| `rantauguard/{PROJECT_ID}/edge/ortu/telemetry` | Edge Ortu | Server, Edge Anak, Dashboard | 1 | Telemetri 2 sensor berkala (posisi GPS live & akselerometer shake) HP ortu setiap 1.5 detik |
| `rantauguard/{PROJECT_ID}/alerts` | Server | Edge Anak, Edge Ortu, Dashboard | 1 | Hasil klasifikasi status dan evaluasi aturan dari server (retained) |
| `rantauguard/{PROJECT_ID}/command/ping` | Edge Ortu, Dashboard | Edge Anak, Server, Dashboard | 1 | Perintah cek status / getar HP anak |
| `rantauguard/{PROJECT_ID}/command/alarm` | Edge Ortu, Dashboard | Edge Anak, Dashboard | 1 | Perintah bunyikan alarm darurat di HP anak |
| `rantauguard/{PROJECT_ID}/command/reminder` | Edge Ortu, Dashboard | Edge Anak, Dashboard | 1 | Perintah pengingat ibadah/kuliah di HP anak |
| `rantauguard/{PROJECT_ID}/command/timemode` | Edge Anak, Dashboard | Edge Anak, Dashboard | 1 | Sinkronisasi simulasi waktu dan kunci koordinat lokasi demo dua arah |

---

## 3. Spesifikasi Payload JSON

### 3.1 `rantauguard/{PROJECT_ID}/edge/anak/telemetry`
Dipublish oleh `edge/anak` (`/anak`) secara berkala (tiap 1 detik) dari 3 sensor fisik (GPS Geolocation, Web Audio API mikrofon, dan DeviceMotionEvent akselerometer):
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

### 3.2 `rantauguard/{PROJECT_ID}/edge/ortu/telemetry`
Dipublish oleh `edge/ortu` (`/ortu`) secara berkala (tiap 1.5 detik) atau saat terjadi event dari 2 sensor fisik (GPS Geolocation dan DeviceMotionEvent akselerometer):
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
Nilai `triggered_by` dapat berupa `"ortu"`, `"dashboard"`, atau `"anak"` (pada topik `command/timemode`):
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
*(Catatan: Koordinat dikonfigurasi melalui file `.env` masing-masing modul: `POI_KAMPUS`, `POI_MASJID`, `POI_KOS`, `POI_BAR`).*

---

## 5. Logika Tabel Keputusan (Decision Table)

| Waktu (`time_label`) | Jarak POI | Desibel (dB) | Status Klasifikasi |
|---|---|---|---|
| `jam_kuliah` | <= 150m kampus | < 65 dB | `SEDANG_KULIAH` |
| `jam_kuliah` | > 150m kampus | bebas | `ALERT_BOLOS_KULIAH` |
| `waktu_sholat` | > 100m masjid | bebas | `WARNING_BELUM_KE_MASJID` |
| `jam_malam` | <= 750m kos (`claimed_at_kos=true`) | > 80 dB | `ANOMALY_FAKE_GPS` (Prioritas Tinggi) |
| `jam_malam` | <= 750m kos | < 55 dB | `ISTIRAHAT_DI_KOS` |
| `jam_malam` | <= 250m bar | > 75 dB | `CRITICAL_TERDETEKSI_DI_BAR` |
| lainnya | - | - | `NORMAL` |
