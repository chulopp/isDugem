// Salin file ini menjadi config.js di folder yang sama:
// cp config.example.js config.js

const CONFIG = {
  PROJECT_ID: "isdugem_tim_01",
  BROKER_WSS_URL: "wss://broker.hivemq.com:8884/mqtt",
  PUBLISH_INTERVAL_MS: 2500,
  TOPICS: {
    TELEMETRY: "rantauguard/isdugem_tim_01/edge/anak/telemetry",
    ALERTS: "rantauguard/isdugem_tim_01/alerts",
    COMMAND_PING: "rantauguard/isdugem_tim_01/command/ping",
    COMMAND_ALARM: "rantauguard/isdugem_tim_01/command/alarm",
    COMMAND_REMINDER: "rantauguard/isdugem_tim_01/command/reminder",
  }
};
