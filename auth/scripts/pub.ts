/**
 * 模拟设备上报。本机明文：npm run pub
 * 生产 TLS：MQTT_TLS=1 MQTT_HOST=api.xmianai.com MQTT_PORT=8883 npm run pub
 */
import mqtt from "mqtt";

const host = process.env.MQTT_HOST ?? "127.0.0.1";
const tls = process.env.MQTT_TLS === "1" || process.env.MQTT_TLS === "true";
const port = Number(process.env.MQTT_PORT ?? (tls ? 8883 : 1883));
const productKey = process.env.SEED_PRODUCT_KEY ?? "xiaomian_mvp";
const sn = (process.env.SEED_DEVICE_SN ?? "SNDEMO0001").toUpperCase();
const password = process.env.SEED_DEVICE_SECRET ?? "demo-device-secret";
const topic = `/sys/${productKey}/${sn}/thing/property/post`;
const scheme = tls ? "mqtts" : "mqtt";

const client = mqtt.connect(`${scheme}://${host}:${port}`, {
  clientId: `${productKey}.${sn}`,
  username: sn,
  password,
  connectTimeout: 8000,
  rejectUnauthorized: process.env.MQTT_TLS_INSECURE === "1" ? false : true,
});

client.on("connect", () => {
  const payload = JSON.stringify({
    method: "thing.property.post",
    version: "1.0",
    params: {
      deviceName: sn,
      airbagsPerson: [1, 0],
      HR: [62, 16, 0, 0, 0, 0],
    },
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
