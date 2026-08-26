/**
 * 模拟设备上报：mqtt pub 一条实时 JSON
 * 用法: MQTT_HOST=127.0.0.1 npm run pub
 */
import mqtt from "mqtt";

const host = process.env.MQTT_HOST ?? "127.0.0.1";
const port = Number(process.env.MQTT_PORT ?? 1883);
const productKey = process.env.SEED_PRODUCT_KEY ?? "xiaomian_mvp";
const sn = process.env.SEED_DEVICE_SN ?? "SNDEMO0001";
const password = process.env.SEED_DEVICE_SECRET ?? "demo-device-secret";
const topic = `${productKey}/${sn}/up/realtime`;

const client = mqtt.connect(`mqtt://${host}:${port}`, {
  clientId: `${productKey}.${sn}`,
  username: sn,
  password,
  connectTimeout: 8000,
});

client.on("connect", () => {
  const payload = JSON.stringify({
    sn,
    heartRate: 62,
    respiratoryRate: 16,
    isbed: 1,
    timeStamp: new Date().toISOString(),
  });
  client.publish(topic, payload, { qos: 1 }, (err) => {
    if (err) {
      console.error("publish failed", err.message);
      process.exit(1);
    }
    console.log("published", topic, payload);
    client.end(true, () => process.exit(0));
  });
});

client.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});
