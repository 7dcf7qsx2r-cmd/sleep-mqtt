import mqtt from "mqtt";
import { parseTopicIdentity } from "./policy.js";
import type { Store } from "./store.js";

const INGEST_FILTERS = [
  "+/+/up/#",
  "+/+/#",
  "/+/+/#",
  "sys/+/+/#",
  "/sys/+/+/#",
];

export function startBridge(store: Store, url: string, password: string): mqtt.MqttClient {
  const client = mqtt.connect(url, {
    clientId: "sleep-mqtt-bridge",
    username: "bridge",
    password,
    reconnectPeriod: 2000,
    clean: true,
  });

  client.on("connect", () => {
    console.log("[bridge] connected", url);
    client.subscribe(INGEST_FILTERS, { qos: 1 }, (err) => {
      if (err) console.warn("[bridge] subscribe failed", err.message);
    });
  });

  client.on("message", (topic, payload) => {
    const parsed = parseTopicIdentity(topic);
    if (!parsed) return;
    let body: unknown = payload.toString("utf8");
    try {
      body = JSON.parse(String(body));
    } catch {
      /* keep string */
    }
    store.appendMessage({
      productKey: parsed.productKey,
      sn: parsed.sn,
      topic,
      payload: body,
    });
    console.log("[bridge] ingest", topic);
  });

  client.on("error", (err) => {
    console.warn("[bridge]", err.message);
  });

  return client;
}
