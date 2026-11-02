// File ini dibuat otomatis oleh dashboard/scripts/export-ml-xai-assets.py
// Jangan diedit manual.

export interface FeatureImportanceItem {
  key: string;
  short_label: string;
  display_name: string;
  importance: number;
  percentage: number;
}

export interface ModelComparisonItem {
  name: string;
  key: string;
  is_production: boolean;
  type: string;
  cv_acc_mean: number;
  cv_acc_std: number;
  cv_f1: number;
  holdout_acc: number;
  holdout_f1: number;
  latency_ms: number;
  pros: string;
  cons: string;
}

export interface IsolationForestMeta {
  fake_gps_recall: number;
  false_positive_rate_normal: number;
  speed_jump_recall: number;
  contamination: number;
  n_estimators: number;
}

export interface MlProductionMeta {
  bundle_version: string;
  sklearn_version: string;
  model_size_kb: number;
  trained_at: string;
  n_samples: number;
  seed: number;
  rf_holdout_accuracy: number;
  rf_holdout_f1_macro: number;
  rf_cv5_accuracy_mean: number;
  rf_cv5_accuracy_std: number;
  features: FeatureImportanceItem[];
  comparisons: ModelComparisonItem[];
  isolation_forest: IsolationForestMeta;
}

export const ML_PRODUCTION_META: MlProductionMeta = {
  bundle_version: "1",
  sklearn_version: "1.9.1",
  model_size_kb: 478.1,
  trained_at: "2026-11-02T10:01:45+00:00",
  n_samples: 5000,
  seed: 42,
  rf_holdout_accuracy: 0.9960,
  rf_holdout_f1_macro: 0.9952,
  rf_cv5_accuracy_mean: 0.9885,
  rf_cv5_accuracy_std: 0.0031,
  features: [
  {
    "key": "time_cos",
    "short_label": "time_cos (Waktu Cos)",
    "display_name": "Waktu Siklikal (Cosinus 24 Jam)",
    "importance": 0.30581447094919384,
    "percentage": 30.58
  },
  {
    "key": "db_level",
    "short_label": "db_level (Suara dB)",
    "display_name": "Tingkat Suara Suasana (dB SPL Raw)",
    "importance": 0.18344385261468327,
    "percentage": 18.34
  },
  {
    "key": "dist_kos_m",
    "short_label": "dist_kos (Jarak Kos)",
    "display_name": "Jarak ke Zona Kos Tembalang",
    "importance": 0.11403048184782404,
    "percentage": 11.4
  },
  {
    "key": "time_sin",
    "short_label": "time_sin (Waktu Sin)",
    "display_name": "Waktu Siklikal (Sinus 24 Jam)",
    "importance": 0.11335561773088038,
    "percentage": 11.34
  },
  {
    "key": "dist_bar_m",
    "short_label": "dist_bar (Jarak Bar)",
    "display_name": "Jarak ke Zona Hiburan Malam",
    "importance": 0.10769441522209368,
    "percentage": 10.77
  },
  {
    "key": "dist_kampus_m",
    "short_label": "dist_kampus (Kampus)",
    "display_name": "Jarak ke Kampus UNDIP",
    "importance": 0.10399825426878598,
    "percentage": 10.4
  },
  {
    "key": "dist_masjid_m",
    "short_label": "dist_masjid (Masjid)",
    "display_name": "Jarak ke Masjid Kampus",
    "importance": 0.053112116841548374,
    "percentage": 5.31
  },
  {
    "key": "speed_mps",
    "short_label": "speed_mps (Kecepatan)",
    "display_name": "Kecepatan Pergerakan (GPS)",
    "importance": 0.018550790524990427,
    "percentage": 1.86
  }
],
  comparisons: [
  {
    "name": "Random Forest (100 Pohon)",
    "key": "random_forest",
    "is_production": true,
    "type": "Ensemble Non-Linear",
    "cv_acc_mean": 0.9884999999999999,
    "cv_acc_std": 0.0031024184114977105,
    "cv_f1": 0.9863911785921117,
    "holdout_acc": 0.996,
    "holdout_f1": 0.9951525302609039,
    "latency_ms": 0.73,
    "pros": "Tahan overfitting, estimasi probabilitas stabil, transparansi feature importance",
    "cons": "Ukuran model lebih besar dibanding Decision Tree tunggal"
  },
  {
    "name": "Decision Tree Tunggal",
    "key": "decision_tree",
    "is_production": false,
    "type": "Single Tree (max_depth=10)",
    "cv_acc_mean": 0.97575,
    "cv_acc_std": 0.005,
    "cv_f1": 0.9782579015661115,
    "holdout_acc": 0.98,
    "holdout_f1": 0.982359769581792,
    "latency_ms": 0.01,
    "pros": "Latensi sangat rendah, mudah dikonversi menjadi if-else",
    "cons": "Rentan overfitting pada data baru ber-noise"
  },
  {
    "name": "Logistic Regression",
    "key": "logistic_regression",
    "is_production": false,
    "type": "Linear Classifier",
    "cv_acc_mean": 0.7484999999999999,
    "cv_acc_std": 0.008,
    "cv_f1": 0.7659183181085548,
    "holdout_acc": 0.76,
    "holdout_f1": 0.7832054572925519,
    "latency_ms": 0.04,
    "pros": "Model matematis sangat sederhana dan ringan",
    "cons": "Tidak mampu memodelkan interaksi non-linear ruang waktu dan suara"
  }
],
  isolation_forest: {
  "fake_gps_recall": 0.16666666666666666,
  "false_positive_rate_normal": 0.029850746268656716,
  "speed_jump_recall": 0.16791044776119404,
  "contamination": 0.02,
  "n_estimators": 50
},
};
