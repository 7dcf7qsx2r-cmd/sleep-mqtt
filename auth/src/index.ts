import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { decideAcl, decideAuth } from "./access.js";
import { startBridge } from "./bridge.js";
import { startEmbeddedBroker } from "./broker.js";
import { configureEmqxHttpAuth, waitForEmqx } from "./emqx.js";
import { vendorConnectParams } from "./policy.js";
import { defaultStore } from "./store.js";

const port = Number(process.env.PORT ?? 8790);
const adminToken = process.env.ADMIN_TOKEN ?? "dev-admin-token";
const bridgeSecret = process.env.BRIDGE_SECRET ?? "dev-bridge-secret";
const mqttUrl = process.env.MQTT_URL ?? "mqtt://127.0.0.1:1883";
const emqxApiUrl = process.env.EMQX_API_URL ?? "http://127.0.0.1:18083";
const emqxUser = process.env.EMQX_DASHBOARD_USER ?? "admin";
const emqxPassword = process.env.EMQX_DASHBOARD_PASSWORD ?? "XiaomianMqtt1";
const publicHost = process.env.MQTT_PUBLIC_HOST ?? "127.0.0.1";
const publicPort = Number(process.env.MQTT_PUBLIC_PORT ?? 1883);
const embedBroker = process.env.EMBED_BROKER === "1" || process.env.EMBED_BROKER === "true";
const brokerPort = Number(process.env.MQTT_LISTEN_PORT ?? publicPort);

const store = defaultStore();
store.upsertSeedDevice({
  productKey: process.env.SEED_PRODUCT_KEY ?? "xiaomian_mvp",
  productName: "小眠 MVP",
  sn: process.env.SEED_DEVICE_SN ?? "SNDEMO0001",
  deviceSecret: process.env.SEED_DEVICE_SECRET ?? "demo-device-secret",
});

function requireAdmin(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === adminToken;
}

const app = new Hono();

app.get("/health", (c) => c.json({
  ok: true,
  service: "sleep-mqtt-auth",
  broker: mqttUrl,
}));

app.post("/mqtt/auth", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(decideAuth(store, body as Record<string, string>, bridgeSecret));
});

app.post("/mqtt/acl", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(decideAcl(store, body as Record<string, string>));
});

app.get("/v1/products", (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  return c.json({ products: store.listProducts() });
});

app.post("/v1/products", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({})) as { name?: string; productKey?: string };
  try {
    const product = store.createProduct(body.name ?? "unnamed", body.productKey);
    return c.json({ product }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "failed" }, 400);
  }
});

app.get("/v1/devices", (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const productKey = c.req.query("productKey");
  const devices = store.listDevices(productKey).map((d) => ({
    ...d,
    connect: vendorConnectParams({
      productKey: d.productKey,
      sn: d.sn,
      deviceSecret: d.deviceSecret,
      host: publicHost,
      port: publicPort,
    }),
  }));
  return c.json({ devices });
});

app.post("/v1/devices", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({})) as { productKey?: string; sn?: string };
  if (!body.productKey) return c.json({ error: "productKey required" }, 400);
  try {
    const device = store.createDevice(body.productKey, body.sn);
    return c.json({
      device,
      connect: vendorConnectParams({
        productKey: device.productKey,
        sn: device.sn,
        deviceSecret: device.deviceSecret,
        host: publicHost,
        port: publicPort,
      }),
    }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "failed" }, 400);
  }
});

app.get("/v1/messages", (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  return c.json({ messages: store.listMessages(c.req.query("sn")) });
});

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`[auth] listening on :${port}`);
});

void (async () => {
  if (embedBroker) {
    await startEmbeddedBroker({ store, bridgeSecret, port: brokerPort });
    startBridge(store, `mqtt://127.0.0.1:${brokerPort}`, bridgeSecret);
    console.log("[auth] embedded broker mode (no EMQX)");
    return;
  }
  try {
    await waitForEmqx(emqxApiUrl, emqxUser, emqxPassword);
    await configureEmqxHttpAuth({
      apiUrl: emqxApiUrl,
      user: emqxUser,
      password: emqxPassword,
      authUrl: `http://mqtt-auth:${port}/mqtt/auth`,
      aclUrl: `http://mqtt-auth:${port}/mqtt/acl`,
    });
    console.log("[auth] EMQX HTTP auth/ACL ready");
    startBridge(store, mqttUrl, bridgeSecret);
  } catch (err) {
    console.error("[auth] EMQX bootstrap failed", err);
  }
})();
