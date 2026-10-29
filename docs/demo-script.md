# Skenario & Skrip Pengujian Demo (isDugem / RantauGuard)

Dokumen ini memandu langkah-langkah demonstrasi sistem IoT isDugem (RantauGuard) untuk presentasi tugas akhir maupun pengujian integrasi antar-modul.

---

## 1. Persiapan Sebelum Demo (Pre-flight Checklist)

1. **Jaringan:**
   - Laptop Dashboard, HP Edge Anak, dan HP Edge Ortu terhubung ke jaringan internet yang stabil.
   - Broker publik HiveMQ (`broker.hivemq.com`) dapat dijangkau.
2. **Environment:**
   - Pastikan variabel `PROJECT_ID` pada modul Server, Dashboard, dan Edge bernilai sama (contoh: `isdugem_tim_01`).
3. **Eksekusi Komponen:**
   - [ ] Server backend Python berjalan (`python main.py` di laptop backend).
   - [ ] Dashboard Next.js berjalan di laptop (`npm run dev` atau buka domain Vercel `https://isdugem.vercel.app/`).
   - [ ] Web app HP Anak (3 sensor: GPS, Mikrofon, Akselerometer) dibuka via scan QR Code / browser HP (`https://isdugem.vercel.app/anak`).
   - [ ] Web app HP Ortu (2 sensor: GPS, Akselerometer Shake-to-Ping) dibuka via scan QR Code / browser HP (`https://isdugem.vercel.app/ortu`).

> **Catatan Mode Demonstrasi & Izin Sensor (HTTP vs HTTPS):**
> - **Rekomendasi Utama Presentasi:** Gunakan **Demo Preset Panel** langsung di antarmuka peramban laptop (`http://localhost:3000` atau `https://isdugem.vercel.app`) atau gunakan fitur **Kunci Koordinat Demo & Kunci Waktu Demo** pada HP Anak (`/anak`).
> - **Akses Smartphone Fisik:** Jika menghubungkan smartphone fisik ke rute `/anak` atau `/ortu`, wajib menggunakan domain **HTTPS resmi** (`https://isdugem.vercel.app`), karena peramban smartphone memblokir akses sensor mikrofon dan GPS pada koneksi HTTP biasa non-localhost.

---

## 2. Urutan Skenario Pengujian & Bukti Output

### Skenario 1: Normal - Mahasiswa Sedang Kuliah
- **Kondisi:** Waktu `jam_kuliah` (09:00), lokasi dalam radius kampus (<= 150m), suara kelas tenang (< 65 dB).
- **Langkah:** Aktifkan preset kampus di Demo Preset Panel atau kunci koordinat kampus di `/anak`.
- **Ekspektasi Output:**
  - Status Card Dashboard: Hijau - `SEDANG_KULIAH`.
  - Peta Dashboard: Marker anak berada di dalam lingkaran geofence Kampus.

### Skenario 2: Peringatan - Mahasiswa Bolos Kuliah
- **Kondisi:** Waktu `jam_kuliah` (10:00), lokasi di luar kampus (> 150m).
- **Langkah:** Geser posisi simulasi ke luar kampus pada jam kuliah.
- **Ekspektasi Output:**
  - Status Card Dashboard: Kuning/Orange - `ALERT_BOLOS_KULIAH`.
  - HP Ortu: Menampilkan status `BOLOS KULIAH` dari server.

### Skenario 3: Peringatan - Waktu Sholat Belum ke Masjid
- **Kondisi:** Waktu `waktu_sholat` (12:15), lokasi di luar radius masjid (> 100m).
- **Langkah:** Ubah waktu ke Simulasi Waktu Sholat saat posisi masih di luar masjid.
- **Ekspektasi Output:**
  - Status Card Dashboard: Kuning - `WARNING_BELUM_KE_MASJID`.
  - Dashboard / HP Ortu: Tekan tombol **"Ingatkan"** -> HP Anak bergetar dan menampilkan pesan pengingat.

### Skenario 4: Anomali - Terdeteksi di Bar Malam Hari
- **Kondisi:** Waktu `jam_malam` (23:00), lokasi dekat Bar (<= 250m), suara bising (> 75 dB).
- **Langkah:** Simulasikan posisi dekat bar (Golden Tiger / Marabunta / RedHare) dan putar audio keras atau bicara dekat mikrofon HP anak.
- **Ekspektasi Output:**
  - Status Card Dashboard: Merah Berkedip - `CRITICAL_TERDETEKSI_DI_BAR`.
  - Audio Visualizer Dashboard: Bar audio melonjak ke area merah (> 75 dB).
  - Dashboard / HP Ortu: Tekan tombol **"Alarm"** -> HP Anak membunyikan sirine darurat dan getar.

### Skenario 5: Fitur Pembeda Utama - Anomaly Fake GPS (Klaim Kos tapi Dentuman Bar)
- **Kondisi:** Waktu `jam_malam`, koordinat GPS mengklaim berada di area kos (<= 750m), tetapi mikrofon mendeteksi suara > 80 dB (dentuman musik/keramaian).
- **Langkah:** Tetapkan koordinat di kos pada HP Anak, lalu hasilkan suara keras > 80 dB pada mikrofon HP anak.
- **Ekspektasi Output:**
  - Server memprioritaskan aturan anomali.
  - Status Card Dashboard & HP Ortu: Merah Anomali - `ANOMALY_FAKE_GPS`.
  - Penjelasan Alasan: *"Klaim lokasi di kos tetapi intensitas suara sekitar mencapai > 80 dB (indikasi Fake GPS)"*.

### Skenario 6: Sensor Ganda Ortu & Komunikasi 2 Arah (GPS Live + Shake-to-Ping)
- **Kondisi:** HP Ortu mengaktifkan 2 sensor fisik (`Geolocation API` untuk GPS dan `DeviceMotionEvent` untuk akselerometer), lalu digoyangkan dengan cepat (> 18 m/s²).
- **Langkah:** Aktifkan sensor pada HP Ortu (`/ortu`), perhatikan posisi GPS Ortu muncul di HP Anak (`/anak`) dan Peta Dashboard, lalu goyangkan HP Ortu.
- **Ekspektasi Output:**
  - Topik `edge/ortu/telemetry` mengirimkan koordinat GPS asli HP Ortu dan jarak Haversine ditampilkan langsung di layar HP Anak serta HP Ortu.
  - Saat HP Ortu digoyangkan, topik `command/ping` terbit secara otomatis.
  - HP Anak: Menerima notifikasi ping seketika, berbunyi, dan bergetar.
  - Dashboard: Menampilkan marker `ORTU` di peta serta riwayat event ping terbaru di Panel Kontrol Sistem.
