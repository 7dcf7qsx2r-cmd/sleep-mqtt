import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import mqtt from "mqtt";
import { startEmbeddedBroker } from "./broker.js";
import { FileStore } from "./store.js";

test("mqtts broker accepts tls connect and publish", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sleep-mqtt-tls-"));
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "1", "-nodes",
    "-subj", "/CN=localhost",
    "-keyout", key,
    "-out", cert,
  ], { stdio: "ignore" });

  const store = new FileStore(join(dir, "store.json"));
  await store.upsertSeedDevice({
    productKey: "xiaomian_mvp",
    productName: "mvp",
    sn: "SNDEMO0001",
    deviceSecret: "demo-device-secret",
  });

  const broker = await startEmbeddedBroker({
    store,
    bridgeSecret: "bridge",
    port: 0,
    listenHost: "127.0.0.1",
    tls: { port: 0, certPath: cert, keyPath: key },
  });
  const tlsPort = (broker.tlsServer!.address() as AddressInfo).port;

  try {
    await new Promise<void>((resolve, reject) => {
      const client = mqtt.connect(`mqtts://127.0.0.1:${tlsPort}`, {
        clientId: "xiaomian_mvp.SNDEMO0001",
        username: "SNDEMO0001",
        password: "demo-device-secret",
        rejectUnauthorized: false,
        connectTimeout: 5000,
      });
      const fail = (err: Error) => {
        client.end(true);
        reject(err);
      };
      client.once("error", fail);
      client.once("connect", () => {
        client.publish("xiaomian_mvp/SNDEMO0001/up/realtime", "{\"ok\":1}", { qos: 1 }, (err) => {
          client.end(true);
          if (err) fail(err);
          else resolve();
        });
      });
    });
  } finally {
    await broker.close();
    rmSync(dir, { recursive: true, force: true });
  }
  assert.ok(true);
});
