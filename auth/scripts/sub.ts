/**
 * 订阅设备下行。本机明文：npm run sub
 * 生产 TLS：MQTT_TLS=1 MQTT_HOST=api.xmianai.com MQTT_PORT=8883 npm run sub
 */
import mqtt from "mqtt";

const host = process.env.MQTT_HOST ?? "127.0.0.1";
const tls = process.env.MQTT_TLS === "1" || process.env.MQTT_TLS === "true";
const port = Number(process.env.MQTT_PORT ?? (tls ? 8883 : 1883));
const productKey = process.env.SEED_PRODUCT_KEY ?? "xiaomian_mvp";
const sn = process.env.SEED_DEVICE_SN ?? "SNDEMO0001";
const password = process.env.SEED_DEVICE_SECRET ?? "demo-device-secret";
const topic = `${productKey}/${sn}/down/#`;
const scheme = tls ? "mqtts" : "mqtt";

const client = mqtt.connect(`${scheme}://${host}:${port}`, {
  clientId: `${productKey}.${sn}`,
  username: sn,
  password,
  rejectUnauthorized: process.env.MQTT_TLS_INSECURE === "1" ? false : true,
});

client.on("connect", () => {
  console.log("connected, subscribe", topic);
  client.subscribe(topic, { qos: 1 });
});

client.on("message", (t, payload) => {
  console.log(t, payload.toString());
});

client.on("error", (err) => {
  console.error(err.message);
});
