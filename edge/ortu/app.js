/**
 * RantauGuard — Edge HP Ortu (Starter Code)
 * Tanggung Jawab: Deteksi shake via DeviceMotionEvent, publish telemetri ortu,
 * dan publish perintah (ping, alarm, reminder) ke broker MQTT.
 */

const defaultProjectId = "isdugem_tim_01";
const cfg = (typeof CONFIG !== "undefined") ? CONFIG : {
  PROJECT_ID: defaultProjectId,
  BROKER_WSS_URL: "wss://broker.hivemq.com:8884/mqtt",
  PUBLISH_INTERVAL_MS: 3000,
  SHAKE_THRESHOLD: 18.0,
  TOPICS: {
    TELEMETRY: `rantauguard/${defaultProjectId}/edge/ortu/telemetry`,
    ALERTS: `rantauguard/${defaultProjectId}/alerts`,
    COMMAND_PING: `rantauguard/${defaultProjectId}/command/ping`,
    COMMAND_ALARM: `rantauguard/${defaultProjectId}/command/alarm`,
    COMMAND_REMINDER: `rantauguard/${defaultProjectId}/command/reminder`,
  }
};

let mqttClient = null;
let sequence = 0;
let lastShakeTime = 0;
let shakeDetectedFlag = false;

const state = {
  location: { lat: -6.9950, lon: 110.4210 },
  motion: { accel_magnitude: 9.8, shake_detected: false }
};

const ui = {
  mqttStatus: document.getElementById("mqttStatus"),
  btnStart: document.getElementById("btnStart"),
  btnPing: document.getElementById("btnPing"),
  btnReminder: document.getElementById("btnReminder"),
  btnAlarm: document.getElementById("btnAlarm"),
  shakeIndicator: document.getElementById("shakeIndicator"),
  valAccel: document.getElementById("valAccel"),
  valLastShake: document.getElementById("valLastShake")
};

function connectMqtt() {
  const clientId = `edge_ortu_${Math.random().toString(16).substring(2, 8)}`;
  mqttClient = mqtt.connect(cfg.BROKER_WSS_URL, { clientId });

  mqttClient.on("connect", () => {
    ui.mqttStatus.innerText = "Connected";
    ui.mqttStatus.className = "badge badge-connected";
    console.log("MQTT Ortu Connected");
    mqttClient.subscribe(cfg.TOPICS.ALERTS);
  });

  mqttClient.on("close", () => {
    ui.mqttStatus.innerText = "Disconnected";
    ui.mqttStatus.className = "badge badge-disconnected";
  });
}

function publishCommand(topic, messageText) {
  if (!mqttClient || !mqttClient.connected) {
    alert("MQTT belum terhubung!");
    return;
  }
  const payload = {
    triggered_by: "ortu",
    timestamp_ms: Date.now(),
    message: messageText
  };
  mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
  console.log(`[Command Sent] ${topic}:`, payload);
}

function initMotion() {
  if (window.DeviceMotionEvent) {
    window.addEventListener("devicemotion", (event) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc) return;

      const mag = Math.sqrt((acc.x || 0) ** 2 + (acc.y || 0) ** 2 + (acc.z || 0) ** 2);
      state.motion.accel_magnitude = Number(mag.toFixed(2));
      ui.valAccel.innerText = `${state.motion.accel_magnitude} m/s²`;

      // Shake detection logic
      const now = Date.now();
      if (mag > cfg.SHAKE_THRESHOLD && (now - lastShakeTime > 2000)) {
        lastShakeTime = now;
        shakeDetectedFlag = true;
        ui.shakeIndicator.classList.add("shaking");
        ui.shakeIndicator.innerText = "⚡ Guncangan Terdeteksi! Mengirim Ping...";
        ui.valLastShake.innerText = new Date().toLocaleTimeString();

        publishCommand(cfg.TOPICS.COMMAND_PING, "Orang tua menggoyangkan HP untuk mengecek Anda!");

        setTimeout(() => {
          ui.shakeIndicator.classList.remove("shaking");
          ui.shakeIndicator.innerText = "Goyangkan HP untuk mengirim ping ke HP Anak";
          shakeDetectedFlag = false;
        }, 1500);
      }
    });
  }
}

function publishTelemetry() {
  if (!mqttClient || !mqttClient.connected) return;

  sequence += 1;
  const payload = {
    device_id: "ortu",
    sequence: sequence,
    sent_at_ms: Date.now(),
    location: state.location,
    motion: {
      accel_magnitude: state.motion.accel_magnitude,
      shake_detected: shakeDetectedFlag
    }
  };

  mqttClient.publish(cfg.TOPICS.TELEMETRY, JSON.stringify(payload), { qos: 1 });
}

// Event Listeners
ui.btnStart.addEventListener("click", () => {
  ui.btnStart.disabled = true;
  ui.btnStart.innerText = "Sistem Ortu Aktif";
  connectMqtt();
  initMotion();
  setInterval(publishTelemetry, cfg.PUBLISH_INTERVAL_MS);
});

ui.btnPing.addEventListener("click", () => {
  publishCommand(cfg.TOPICS.COMMAND_PING, "Orang tua sedang mengecek posisi Anda!");
});

ui.btnReminder.addEventListener("click", () => {
  publishCommand(cfg.TOPICS.COMMAND_REMINDER, "Jangan lupa waktu ibadah / cek jadwal kuliah!");
});

ui.btnAlarm.addEventListener("click", () => {
  publishCommand(cfg.TOPICS.COMMAND_ALARM, "PERINGATAN: Orang tua mengaktifkan alarm darurat!");
});
