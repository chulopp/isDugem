# Skenario & Skrip Pengujian Demo (RantauGuard)

Dokumen ini memandu langkah-langkah demonstrasi sistem IoT RantauGuard (isDugem) untuk presentasi tugas akhir maupun pengujian integrasi antar-modul.

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
   - [ ] Web app HP Anak dibuka via scan QR Code / browser HP (`https://isdugem.vercel.app/anak`).
   - [ ] Web app HP Ortu dibuka via scan QR Code / browser HP (`https://isdugem.vercel.app/ortu`).

---

## 2. Urutan Skenario Pengujian & Bukti Output

### Skenario 1: Normal — Mahasiswa Sedang Kuliah
- **Kondisi:** Waktu `jam_kuliah` (09:00), lokasi dalam radius kampus (≤ 150m), suara kelas tenang (< 65 dB).
- **Langkah:** Aktifkan preset kampus di Demo Preset Panel atau kirim telemetry posisi kampus.
- **Ekspektasi Output:**
  - Status Card Dashboard: Hijau — `SEDANG_KULIAH`.
  - Peta Dashboard: Marker anak berada di dalam lingkaran geofence Kampus.

### Skenario 2: Peringatan — Mahasiswa Bolos Kuliah
- **Kondisi:** Waktu `jam_kuliah` (10:00), lokasi di luar kampus (> 150m).
- **Langkah:** Geser posisi simulasi ke luar kampus.
- **Ekspektasi Output:**
  - Status Card Dashboard: Kuning/Orange — `ALERT_BOLOS_KULIAH`.
  - HP Anak: Menerima alert via MQTT.

### Skenario 3: Peringatan — Waktu Sholat Belum ke Masjid
- **Kondisi:** Waktu `waktu_sholat` (12:15), lokasi di luar radius masjid (> 100m).
- **Langkah:** Ubah waktu ke Dzuhur/Maghrib saat posisi masih di luar masjid.
- **Ekspektasi Output:**
  - Status Card Dashboard: Kuning — `WARNING_BELUM_KE_MASJID`.
  - Dashboard CommandCenter: Tekan tombol **"Kirim Pengingat Sholat"** -> HP Anak bergetar dan menampilkan pesan reminder.

### Skenario 4: Anomali — Terdeteksi di Bar Malam Hari
- **Kondisi:** Waktu `jam_malam` (23:00), lokasi dekat Bar (≤ 100m), suara bising (> 75 dB).
- **Langkah:** Simulasikan posisi dekat bar dan putar audio keras/bicara dekat mic HP anak.
- **Ekspektasi Output:**
  - Status Card Dashboard: Merah Berkedip — `CRITICAL_TERDETEKSI_DI_BAR`.
  - Audio Visualizer Dashboard: Bar audio melonjak ke area merah (> 75 dB).
  - Dashboard CommandCenter: Tekan tombol **"Trigger Alarm"** -> HP Anak membunyikan alarm visual/getar.

### Skenario 5: Fitur Pembeda Utama — Anomaly Fake GPS (Klaim Kos tapi Dentuman Bar)
- **Kondisi:** Waktu `jam_malam`, koordinat GPS mengklaim berada di dalam kamar kos (≤ 50m), tetapi mikrofon mendeteksi suara > 80 dB (dentuman musik/keramaian).
- **Langkah:** Tetapkan koordinat di kos, hasilkan suara keras > 80 dB pada HP anak.
- **Ekspektasi Output:**
  - Server memprioritaskan aturan anomali.
  - Status Card Dashboard: Merah Anomali — `ANOMALY_FAKE_GPS`.
  - Penjelasan Alasan: *"Klaim lokasi di kos tetapi intensitas suara sekitar mencapai 82 dB (indikasi Fake GPS)"*.

### Skenario 6: Komunikasi 2 Arah — Shake-to-Ping dari HP Ortu
- **Kondisi:** HP Ortu diayunkan/digoyangkan dengan cepat (`DeviceMotionEvent`).
- **Langkah:** Goyangkan HP Ortu (atau tekan tombol "Ping Anak").
- **Ekspektasi Output:**
  - Topic `command/ping` terbit.
  - HP Anak: Menerima notifikasi seketika dan bergetar (`navigator.vibrate([200, 100, 200])`).
  - Dashboard: Menampilkan riwayat event ping terbaru di CommandCenter.
