## Deskripsi Perubahan
<!-- Jelaskan secara ringkas fitur baru, perbaikan bug, atau perubahan apa yang dibuat pada PR ini. -->

## Modul yang Terdampak
- [ ] `edge/anak` (Web Sensor HP Anak)
- [ ] `edge/ortu` (Web Remote HP Ortu)
- [ ] `server` (Backend Processing & Decision Engine)
- [ ] `dashboard` (Next.js Monitoring Dashboard)
- [ ] `docs` (Dokumentasi / Skema)

## Tipe Perubahan
- [ ] `feat`: Penambahan fitur baru
- [ ] `fix`: Perbaikan bug/isu
- [ ] `refactor`: Refaktorisasi kode tanpa merubah fungsionalitas
- [ ] `test`: Penambahan atau perbaikan unit test
- [ ] `docs`: Pembaruan dokumentasi

---

## Checklist Verifikasi Wajib (Harus Dicentang Sebelum Merge!)

Silakan periksa dan centang seluruh poin di bawah ini:
- [ ] **Kontrak Data:** Nama topik MQTT dan struktur JSON payload **sama persis** dengan spesifikasi di `docs/mqtt-schema.md`.
- [ ] **Bebas Kredensial:** Tidak ada file `.env`, kredensial, atau token rahasia yang ter-commit (cek `git status` dan file diff).
- [ ] **Pengujian Lokal:** Modul sudah dicoba dan berjalan lancar secara standalone di lingkungan lokal masing-masing.
- [ ] **Unit Testing (Khusus Server):** Seluruh unit test (`pytest`) di folder `server/tests/` lulus tanpa error.
- [ ] **Tinjauan Tim:** Minimal 1 rekan tim telah meninjau dan memberikan persetujuan (Approve) pada Pull Request ini.

---

## Bukti Pengujian (Screenshot / Log)
<!-- Tempel screenshot antarmuka, log konsol MQTT, atau output terminal saat modul dijalankan untuk membuktikan bahwa fitur sudah diuji. -->
