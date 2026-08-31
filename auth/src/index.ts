import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { decideAcl, decideAuth } from "./access.js";
import { startBridge } from "./bridge.js";
import { startEmbeddedBroker } from "./broker.js";
import { attachDownlinkPublisher, DownlinkError, parseCommandBody, publishServiceInvoke } from "./downlink.js";
import { configureEmqxHttpAuth, waitForEmqx } from "./emqx.js";
import { CIS_PRODUCTS } from "./catalog.js";
import { vendorConnectParams } from "./policy.js";
import { openStore } from "./store.js";

const port = Number(process.env.PORT ?? 8790);
const adminToken = process.env.ADMIN_TOKEN ?? "dev-admin-token";
const bridgeSecret = process.env.BRIDGE_SECRET ?? "dev-bridge-secret";
const mqttUrl = process.env.MQTT_URL ?? "mqtt://127.0.0.1:1883";
const emqxApiUrl = process.env.EMQX_API_URL ?? "http://127.0.0.1:18083";
const emqxUser = process.env.EMQX_DASHBOARD_USER ?? "admin";
const emqxPassword = process.env.EMQX_DASHBOARD_PASSWORD ?? "XiaomianMqtt1";
const publicTls = process.env.MQTT_TLS === "1" || process.env.MQTT_TLS === "true";
const tlsCert = process.env.MQTT_TLS_CERT ?? "";
const tlsKey = process.env.MQTT_TLS_KEY ?? "";
const tlsPort = Number(process.env.MQTT_TLS_PORT ?? 8883);
const publicHost = process.env.MQTT_PUBLIC_HOST ?? (publicTls ? "api.xmianai.com" : "127.0.0.1");
const publicPort = Number(process.env.MQTT_PUBLIC_PORT ?? (publicTls ? tlsPort : 1883));
const embedBroker = process.env.EMBED_BROKER === "1" || process.env.EMBED_BROKER === "true";
const brokerPort = Number(process.env.MQTT_LISTEN_PORT ?? 1883);
const brokerListenHost = process.env.MQTT_LISTEN_HOST ?? "0.0.0.0";

if (publicTls && (!tlsCert || !tlsKey)) {
  throw new Error("MQTT_TLS=1 需要 MQTT_TLS_CERT 与 MQTT_TLS_KEY");
}

const store = await openStore();
await store.upsertSeedDevice({
  productKey: process.env.SEED_PRODUCT_KEY ?? "xiaomian_mvp",
  productName: "小眠 MVP",
  sn: process.env.SEED_DEVICE_SN ?? "SNDEMO0001",
  deviceSecret: process.env.SEED_DEVICE_SECRET ?? "demo-device-secret",
});
for (const product of CIS_PRODUCTS) {
  const secret = process.env[product.envSecret]?.trim() || `lab-${product.productKey}-secret`;
  await store.ensureProduct({
    productKey: product.productKey,
    name: product.name,
    productSecret: secret,
  });
  console.log("[auth] product ready", product.productKey, "secretLen", secret.length);
}

function requireAdmin(c: { req: { header: (name: string) => string | undefined } }): boolean {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === adminToken;
}

const app = new Hono();

app.get("/health", async (c) => {
  const products = await store.listProducts().catch(() => []);
  return c.json({
    ok: true,
    service: "sleep-mqtt-auth",
    storage: store.kind,
    tls: publicTls,
    broker: publicTls
      ? `mqtts://${publicHost}:${publicPort}`
      : `mqtt://${publicHost}:${publicPort}`,
    plaintext: `mqtt://127.0.0.1:${brokerPort}`,
    products: products.map((product) => ({
      productKey: product.productKey,
      hasSecret: Boolean(product.productSecret),
    })),
  });
});

app.post("/mqtt/auth", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await decideAuth(store, body as Record<string, string>, bridgeSecret));
});

app.post("/mqtt/acl", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  return c.json(await decideAcl(store, body as Record<string, string>));
});

app.get("/v1/products", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  return c.json({
    products: (await store.listProducts()).map((product) => ({
      productKey: product.productKey,
      name: product.name,
      createdAt: product.createdAt,
    })),
  });
});

app.post("/v1/products", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({})) as { name?: string; productKey?: string };
  try {
    const product = await store.createProduct(body.name ?? "unnamed", body.productKey);
    return c.json({ product }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "failed" }, 400);
  }
});

app.get("/v1/devices", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const productKey = c.req.query("productKey");
  const devices = (await store.listDevices(productKey)).map((d) => ({
    ...d,
    connect: vendorConnectParams({
      productKey: d.productKey,
      sn: d.sn,
      deviceSecret: d.deviceSecret,
      host: publicHost,
      port: publicPort,
      tls: publicTls,
    }),
  }));
  return c.json({ devices });
});

app.post("/v1/devices", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({})) as { productKey?: string; sn?: string };
  if (!body.productKey) return c.json({ error: "productKey required" }, 400);
  try {
    const device = await store.createDevice(body.productKey, body.sn);
    return c.json({
      device,
      connect: vendorConnectParams({
        productKey: device.productKey,
        sn: device.sn,
        deviceSecret: device.deviceSecret,
        host: publicHost,
        port: publicPort,
        tls: publicTls,
      }),
    }, 201);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "failed" }, 400);
  }
});

app.get("/v1/messages", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  return c.json({ messages: await store.listMessages(c.req.query("sn")) });
});

app.post("/v1/command", async (c) => {
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const command = parseCommandBody(body);
    const result = await publishServiceInvoke({
      productKey: command.productKey,
      sn: command.sn,
      payload: command.payload,
    });
    console.log("[downlink] published", result.topic);
    return c.json({ ok: true, topic: result.topic });
  } catch (err) {
    if (err instanceof DownlinkError) {
      const status = err.code === "unavailable" ? 503 : 400;
      return c.json({ error: err.code, message: err.message }, status);
    }
    return c.json({ error: "failed", message: err instanceof Error ? err.message : "failed" }, 500);
  }
});

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`[auth] listening on :${port}`);
});

void (async () => {
  if (embedBroker) {
    await startEmbeddedBroker({
      store,
      bridgeSecret,
      port: brokerPort,
      listenHost: brokerListenHost,
      tls: publicTls
        ? { port: tlsPort, certPath: tlsCert, keyPath: tlsKey }
        : undefined,
    });
    attachDownlinkPublisher(startBridge(store, `mqtt://127.0.0.1:${brokerPort}`, bridgeSecret));
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
    attachDownlinkPublisher(startBridge(store, mqttUrl, bridgeSecret));
  } catch (err) {
    console.error("[auth] EMQX bootstrap failed", err);
  }
})();
