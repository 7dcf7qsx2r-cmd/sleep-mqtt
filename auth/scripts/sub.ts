/**
 * 订阅设备下行，并顺带打印桥接是否收到上行（本进程只订 down）
 * 用法: MQTT_HOST=127.0.0.1 npm run sub
 */
import mqtt from "mqtt";

const host = process.env.MQTT_HOST ?? "127.0.0.1";
const port = Number(process.env.MQTT_PORT ?? 1883);
const productKey = process.env.SEED_PRODUCT_KEY ?? "xiaomian_mvp";
const sn = process.env.SEED_DEVICE_SN ?? "SNDEMO0001";
const password = process.env.SEED_DEVICE_SECRET ?? "demo-device-secret";
const topic = `${productKey}/${sn}/down/#`;

const client = mqtt.connect(`mqtt://${host}:${port}`, {
  clientId: `${productKey}.${sn}`,
  username: sn,
  password,
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
