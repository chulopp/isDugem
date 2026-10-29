/**
 * isDugem (RantauGuard) - Edge HP Anak (Fallback Standalone)
 * Tanggung Jawab: Baca Geolocation API, Web Audio API (RMS -> dB), DeviceMotion API,
 * publish telemetri ke broker MQTT, terima telemetri GPS orang tua, serta subscribe ke alerts & commands.
 */

// Konfigurasi default (akan ditimpa oleh config.js jika tersedia)
const defaultProjectId = "isdugem_tim_01";
const cfg = (typeof CONFIG !== "undefined") ? CONFIG : {
  PROJECT_ID: defaultProjectId,
  BROKER_WSS_URL: "wss://broker.hivemq.com:8884/mqtt",
  PUBLISH_INTERVAL_MS: 1500,
  TOPICS: {
    TELEMETRY: `rantauguard/${defaultProjectId}/edge/anak/telemetry`,
    ORTU_TELEMETRY: `rantauguard/${defaultProjectId}/edge/ortu/telemetry`,
    ALERTS: `rantauguard/${defaultProjectId}/alerts`,
    COMMAND_PING: `rantauguard/${defaultProjectId}/command/ping`,
    COMMAND_ALARM: `rantauguard/${defaultProjectId}/command/alarm`,
    COMMAND_REMINDER: `rantauguard/${defaultProjectId}/command/reminder`,
  }
};

let mqttClient = null;
let sequence = 0;
let publishTimer = null;

// State pembacaan sensor terkini
const state = {
  location: { lat: 0.0, lon: 0.0, accuracy_m: 0.0 },
  audio: { rms: 0.0, db: 0.0 },
  motion: { accel_magnitude: 9.8 },
  ortuLocation: null
};

// UI Elements
const ui = {
  mqttStatus: document.getElementById("mqttStatus"),
  btnStartSensors: document.getElementById("btnStartSensors"),
  valLat: document.getElementById("valLat"),
  valLon: document.getElementById("valLon"),
  valAccuracy: document.getElementById("valAccuracy"),
  valGpsStatus: document.getElementById("valGpsStatus"),
  valOrtuGps: document.getElementById("valOrtuGps"),
  valOrtuDist: document.getElementById("valOrtuDist"),
  valDb: document.getElementById("valDb"),
  valRms: document.getElementById("valRms"),
  valAccel: document.getElementById("valAccel"),
  valSequence: document.getElementById("valSequence"),
  alertBox: document.getElementById("alertBox"),
  alertStatus: document.getElementById("alertStatus"),
  alertReason: document.getElementById("alertReason"),
};

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * 1. Geolocation API: Dapatkan posisi terkini
 */
function initGps() {
  if (!("geolocation" in navigator)) {
    ui.valGpsStatus.innerText = "Tidak didukung";
    return;
  }
  ui.valGpsStatus.innerText = "Aktif";
  navigator.geolocation.watchPosition(
    (pos) => {
      state.location.lat = Number(pos.coords.latitude.toFixed(6));
      state.location.lon = Number(pos.coords.longitude.toFixed(6));
      state.location.accuracy_m = Number((pos.coords.accuracy || 0).toFixed(1));

      ui.valLat.innerText = state.location.lat;
      ui.valLon.innerText = state.location.lon;
      ui.valAccuracy.innerText = `${state.location.accuracy_m} m`;

      if (state.ortuLocation && ui.valOrtuDist) {
        const d = haversineM(state.location.lat, state.location.lon, state.ortuLocation.lat, state.ortuLocation.lon);
        ui.valOrtuDist.innerText = d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${d} m`;
      }
    },
    (err) => {
      console.warn("Gps error:", err.message);
      ui.valGpsStatus.innerText = "Error izin/GPS";
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 5000 }
  );
}

/**
 * 2. Web Audio API: Hitung RMS dan konversi ke dB
 * Formula: 20 * log10(rms) + 100, clamp [0, 120]
 */
async function initAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const dataArray = new Float32Array(analyser.fftSize);

    setInterval(() => {
      analyser.getFloatTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sumSquares += dataArray[i] * dataArray[i];
      }
      const rmsVal = Math.sqrt(sumSquares / dataArray.length);
      let db = 0;
      if (rmsVal > 0) {
        db = 20 * Math.log10(rmsVal) + 100;
        db = Math.max(0, Math.min(120, db));
      }

      state.audio.rms = Number(rmsVal.toFixed(4));
      state.audio.db = Number(db.toFixed(1));

      ui.valRms.innerText = state.audio.rms;
      ui.valDb.innerText = `${state.audio.db} dB`;
    }, 200);
  } catch (err) {
    console.warn("Mikrofon tidak diizinkan atau tidak tersedia:", err);
  }
}

/**
 * 3. DeviceMotion API: Baca accelerometer
 */
function initMotion() {
  if (window.DeviceMotionEvent) {
    window.addEventListener("devicemotion", (event) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc) return;

      const mag = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
      state.motion.accel_magnitude = Number(mag.toFixed(2));
      ui.valAccel.innerText = `${state.motion.accel_magnitude} m/s²`;
    });
  }
}

/**
 * 4. MQTT Connection & Messaging
 */
function connectMqtt() {
  if (typeof mqtt === "undefined") {
    console.error("MQTT.js belum termuat.");
    return;
  }

  const clientId = `edge_anak_${Math.random().toString(16).substring(2, 8)}`;
  mqttClient = mqtt.connect(cfg.BROKER_WSS_URL, { clientId });

  mqttClient.on("connect", () => {
    ui.mqttStatus.innerText = "Connected";
    ui.mqttStatus.className = "badge badge-connected";
    console.log("MQTT Connected ke HiveMQ via WSS");

    // Subscribe ke topic alerts, telemetri ortu, dan perintah
    mqttClient.subscribe(cfg.TOPICS.ALERTS);
    mqttClient.subscribe(cfg.TOPICS.ORTU_TELEMETRY);
    mqttClient.subscribe(cfg.TOPICS.COMMAND_PING);
    mqttClient.subscribe(cfg.TOPICS.COMMAND_ALARM);
    mqttClient.subscribe(cfg.TOPICS.COMMAND_REMINDER);
  });

  mqttClient.on("close", () => {
    ui.mqttStatus.innerText = "Disconnected";
    ui.mqttStatus.className = "badge badge-disconnected";
  });

  mqttClient.on("message", (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      onMessage(topic, payload);
    } catch (e) {
      console.error("Gagal parse pesan masuk:", e);
    }
  });
}

/**
 * Handle incoming alert & command
 */
function onMessage(topic, payload) {
  if (topic.includes("edge/ortu/telemetry")) {
    if (payload.location && ui.valOrtuGps) {
      state.ortuLocation = payload.location;
      ui.valOrtuGps.innerText = `${payload.location.lat.toFixed(4)}, ${payload.location.lon.toFixed(4)}`;
      if (state.location.lat !== 0 && ui.valOrtuDist) {
        const d = haversineM(state.location.lat, state.location.lon, payload.location.lat, payload.location.lon);
        ui.valOrtuDist.innerText = d >= 1000 ? `${(d / 1000).toFixed(2)} km` : `${d} m`;
      }
    }
    return;
  }

  if (topic.includes("alerts")) {
    ui.alertBox.classList.add("active");
    ui.alertStatus.innerText = `[${payload.status}]`;
    ui.alertReason.innerText = payload.reason || "Kondisi tidak biasa terdeteksi";
  } else if (topic.includes("command/ping")) {
    if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
    alert(`[PING DARI ORTU]: ${payload.message || "Cek posisi!"}`);
  } else if (topic.includes("command/alarm")) {
    if ("vibrate" in navigator) navigator.vibrate([500, 200, 500, 200, 500]);
    alert(`[ALARM DARURAT]: ${payload.message || "Peringatan darurat!"}`);
  } else if (topic.includes("command/reminder")) {
    if ("vibrate" in navigator) navigator.vibrate([200, 200]);
    alert(`[PENGINGAT]: ${payload.message || "Waktunya ibadah / aktivitas penting!"}`);
  }
}

/**
 * Publish Telemetry sesuai kontrak Bagian 6.2 PRD
 */
function publishTelemetry() {
  if (!mqttClient || !mqttClient.connected) return;

  sequence += 1;
  const payload = {
    device_id: "anak",
    sequence: sequence,
    sent_at_ms: Date.now(),
    location: {
      lat: state.location.lat,
      lon: state.location.lon,
      accuracy_m: state.location.accuracy_m
    },
    audio: {
      rms: state.audio.rms,
      db: state.audio.db
    },
    motion: {
      accel_magnitude: state.motion.accel_magnitude
    }
  };

  mqttClient.publish(cfg.TOPICS.TELEMETRY, JSON.stringify(payload), { qos: 1 });
  ui.valSequence.innerText = sequence;
}

// Event Listeners
ui.btnStartSensors.addEventListener("click", async () => {
  ui.btnStartSensors.disabled = true;
  ui.btnStartSensors.innerText = "Sensor Berjalan...";

  initGps();
  await initAudio();
  initMotion();
  connectMqtt();

  if (publishTimer) clearInterval(publishTimer);
  publishTimer = setInterval(publishTelemetry, cfg.PUBLISH_INTERVAL_MS);
});
