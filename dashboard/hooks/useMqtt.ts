"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import mqtt, { MqttClient } from "mqtt";
import { MQTT_TOPICS, MQTT_WSS_URL } from "@/lib/mqttTopics";
import {
  Alert,
  AnakTelemetry,
  CommandPayload,
  OrtuTelemetry,
} from "@/lib/types";

interface UseMqttHandlers {
  onAnakTelemetry?: (payload: AnakTelemetry) => void;
  onOrtuTelemetry?: (payload: OrtuTelemetry) => void;
  onAlert?: (payload: Alert) => void;
  onCommand?: (topic: string, payload: CommandPayload) => void;
}

export function useMqtt(handlers: UseMqttHandlers) {
  const [isConnected, setIsConnected] = useState(false);
  const clientRef = useRef<MqttClient | null>(null);
  const handlersRef = useRef<UseMqttHandlers>(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    const clientId = `isdugem_web_${Math.random().toString(16).slice(2, 10)}`;
    const client = mqtt.connect(MQTT_WSS_URL, {
      clientId,
      keepalive: 30,
      reconnectPeriod: 3000,
      connectTimeout: 10000,
    });

    clientRef.current = client;

    client.on("connect", () => {
      setIsConnected(true);
      client.subscribe(
        [
          MQTT_TOPICS.ANAK_TELEMETRY,
          MQTT_TOPICS.ORTU_TELEMETRY,
          MQTT_TOPICS.ALERTS,
          MQTT_TOPICS.ALL_COMMANDS,
        ],
        { qos: 1 }
      );
    });

    client.on("close", () => {
      setIsConnected(false);
    });

    client.on("error", () => {
      setIsConnected(false);
    });

    client.on("message", (topic, buf) => {
      try {
        const data = JSON.parse(buf.toString());
        if (topic === MQTT_TOPICS.ANAK_TELEMETRY) {
          handlersRef.current.onAnakTelemetry?.(data as AnakTelemetry);
        } else if (topic === MQTT_TOPICS.ORTU_TELEMETRY) {
          handlersRef.current.onOrtuTelemetry?.(data as OrtuTelemetry);
        } else if (topic === MQTT_TOPICS.ALERTS) {
          handlersRef.current.onAlert?.(data as Alert);
        } else if (topic.includes("/command/")) {
          handlersRef.current.onCommand?.(topic, data as CommandPayload);
        }
      } catch {
        // Ignore malformed JSON
      }
    });

    return () => {
      client.end(true);
      clientRef.current = null;
    };
  }, []);

  const publishRaw = useCallback((topic: string, payload: unknown) => {
    if (clientRef.current && clientRef.current.connected) {
      clientRef.current.publish(topic, JSON.stringify(payload), { qos: 1 });
      return true;
    }
    return false;
  }, []);

  const publishCommand = useCallback(
    (
      type: "ping" | "reminder" | "alarm",
      customMessage?: string,
      triggeredBy: "dashboard" | "ortu" = "dashboard"
    ) => {
      const topicMap = {
        ping: MQTT_TOPICS.COMMAND_PING,
        reminder: MQTT_TOPICS.COMMAND_REMINDER,
        alarm: MQTT_TOPICS.COMMAND_ALARM,
      };
      const defaultMsgMap = {
        ping: "Pengecekan lokasi dari sistem pemantauan.",
        reminder: "Pengingat jadwal kuliah atau waktu sholat.",
        alarm: "Peringatan bahaya: lokasi atau suara tidak sesuai.",
      };
      const payload: CommandPayload = {
        triggered_by: triggeredBy,
        timestamp_ms: Date.now(),
        message: customMessage || defaultMsgMap[type],
      };
      publishRaw(topicMap[type], payload);
      return payload;
    },
    [publishRaw]
  );

  return {
    isConnected,
    publishRaw,
    publishCommand,
  };
}
