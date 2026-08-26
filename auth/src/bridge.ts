import mqtt from "mqtt";
import { parseClientId } from "./policy.js";
import type { FileStore } from "./store.js";

export function startBridge(store: FileStore, url: string, password: string): mqtt.MqttClient {
  const client = mqtt.connect(url, {
    clientId: "sleep-mqtt-bridge",
    username: "bridge",
    password,
    reconnectPeriod: 2000,
    clean: true,
  });

  client.on("connect", () => {
    console.log("[bridge] connected", url);
    client.subscribe("+/+/up/#", { qos: 1 }, (err) => {
      if (err) console.warn("[bridge] subscribe failed", err.message);
    });
  });

  client.on("message", (topic, payload) => {
    const parts = topic.split("/");
    const productKey = parts[0] ?? "";
    const sn = parts[1] ?? "";
    let body: unknown = payload.toString("utf8");
    try {
      body = JSON.parse(String(body));
    } catch {
      /* keep string */
    }
    const parsed = parseClientId(`${productKey}.${sn}`);
    if (!parsed) return;
    store.appendMessage({ productKey, sn, topic, payload: body });
    console.log("[bridge] ingest", topic);
  });

  client.on("error", (err) => {
    console.warn("[bridge]", err.message);
  });

  return client;
}
