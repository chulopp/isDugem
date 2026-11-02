# Ringkasan Benchmark & Evaluasi Machine Learning isDugem

Dokumen ini memuat data kuantitatif evaluasi model untuk materi presentasi (PPT) tugas praktek IoT.

---

## 1. Komparasi Algoritma Klasifikasi (Dataset Sintetis Ber-noise 5.000 Sampel)

| Algoritma | Tipe Arsitektur | 5-Fold CV Accuracy | 5-Fold CV F1-Macro | Holdout Accuracy | Holdout F1-Macro | Latensi Inferensi |
|---|---|---|---|---|---|---|
| **Random Forest (100 Trees)** *(Produksi)* | Ensemble Bagging | **98.85% ± 0.31%** | **98.64%** | **99.60%** | **99.52%** | **0.73 ms** |
| Decision Tree Tunggal | Single Tree (`max_depth=10`) | 97.58% | 97.83% | 98.00% | 98.24% | 0.01 ms |
| Logistic Regression | Linear Classifier (StandardScaler) | 74.85% | 76.59% | 76.00% | 78.32% | 0.04 ms |

### Mengapa Random Forest Mengungguli Algoritma Lain?
1. **Ketahanan Overfitting:** Random Forest memadukan 100 Decision Tree dengan bootstrap aggregating, sehingga deviasi prediksi jauh lebih stabil pada data telemetri yang rentan jitter sensor.
2. **Kapasitas Non-Linear:** Logistic Regression hanya mencapai akurasi ~74.8% karena tidak mampu menangkap korelasi silang waktu dan lokasi (misal jam malam dekat bar vs jam kuliah dekat bar).
3. **Latensi Sangat Rendah:** Rata-rata inferensi per data hanya 0.73 ms di Python, memenuhi batas aman IoT real-time (< 5 ms).

---

## 2. Transparansi Model: Feature Importance (Explainable AI)

Berikut adalah urutan bobot kontribusi fitur terhadap keputusan Random Forest:

| Peringkat | Variabel Fitur | Keterangan Fitur | Bobot Penting | Persentase |
|---|---|---|---|---|
| 1 | `time_cos` | Waktu Siklikal (Cosinus 24 Jam) | 0.3058 | **30.6%** |
| 2 | `db_level` | Tingkat Suara Suasana (dB SPL Raw) | 0.1834 | **18.3%** |
| 3 | `dist_kos_m` | Jarak ke Zona Kos Tembalang | 0.1140 | **11.4%** |
| 4 | `time_sin` | Waktu Siklikal (Sinus 24 Jam) | 0.1134 | **11.3%** |
| 5 | `dist_bar_m` | Jarak ke Zona Hiburan Malam | 0.1077 | **10.8%** |
| 6 | `dist_kampus_m` | Jarak ke Kampus UNDIP | 0.1040 | **10.4%** |
| 7 | `dist_masjid_m` | Jarak ke Masjid Kampus | 0.0531 | **5.3%** |
| 8 | `speed_mps` | Kecepatan Pergerakan (GPS) | 0.0186 | **1.9%** |

---

## 3. Deteksi Anomali Unsupervised (Isolation Forest)

- **Jumlah Pohon Isolasi:** 50 pohon
- **Tingkat Kontaminasi Terlatih:** 2%
- **Recall pada Skenario ANOMALY_FAKE_GPS:** 16.7%
- **False Positive Rate pada Data Normal:** 3.0%
- **Recall Lonjakan Kecepatan Ekstrem (>= 70 m/s):** 16.8%

---

## 4. File Grafis Pendukung Slide

- Grafik Feature Importance SVG: `docs/ml-benchmark/feature_importances.svg`
- Grafik Komparasi Algoritma SVG: `docs/ml-benchmark/algorithm_comparison.svg`
