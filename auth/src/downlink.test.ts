import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import mqtt from "mqtt";
import { startEmbeddedBroker } from "./broker.js";
import { startBridge } from "./bridge.js";
import {
  attachDownlinkPublisher,
  buildServiceInvokeEnvelope,
  parseCommandBody,
  publishServiceInvoke,
} from "./downlink.js";
import { FileStore } from "./store.js";
import { cisThingTopics } from "./policy.js";

test("service invoke envelope has one service object", () => {
  const envelope = buildServiceInvokeEnvelope("setMotor", { num: 1, height: 0 });
  assert.equal(envelope.method, "thing.service.invoke");
  assert.deepEqual(envelope.params, { setMotor: { num: 1, height: 0 } });
});

test("parseCommandBody accepts service+params or payload", () => {
  const fromService = parseCommandBody({
    productKey: "cis_ib",
    sn: "744dbd7785d4",
    service: "socketStatus",
    params: { status: 1 },
  });
  assert.equal(fromService.sn, "744DBD7785D4");
  assert.deepEqual(fromService.payload.params, { socketStatus: { status: 1 } });

  const fromPayload = parseCommandBody({
    productKey: "cis_ip",
    sn: "744DBD7785D4",
    payload: {
      method: "thing.service.invoke",
      params: { setHeating: { heatingStatus: 1, heatingLevel: 1 } },
    },
  });
  assert.equal(fromPayload.productKey, "cis_ip");
  assert.equal(Object.keys(fromPayload.payload.params).length, 1);
});

test("parseCommandBody rejects two services in one payload", () => {
  assert.throws(
    () => parseCommandBody({
      productKey: "cis_ib",
      sn: "SNDEMO0001",
      payload: {
        method: "thing.service.invoke",
        params: { setMotor: { num: 1 }, setPressure: { num: 1 } },
      },
    }),
    /一个服务/,
  );
});

test("bridge can publish service/invoke to a subscribed device", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sleep-mqtt-down-"));
  const store = new FileStore(join(dir, "store.json"));
  await store.upsertSeedDevice({
    productKey: "cis_ib",
    productName: "CIS-IB",
    sn: "SNDEMO0001",
    deviceSecret: "demo-device-secret",
  });

  const broker = await startEmbeddedBroker({
    store,
    bridgeSecret: "bridge-secret",
    port: 0,
    listenHost: "127.0.0.1",
  });
  const port = (broker.server.address() as AddressInfo).port;
  const url = `mqtt://127.0.0.1:${port}`;
  const bridge = startBridge(store, url, "bridge-secret");
  attachDownlinkPublisher(bridge);

  const topic = cisThingTopics("cis_ib", "SNDEMO0001").serviceInvoke;
  const envelope = buildServiceInvokeEnvelope("setMotor", { num: 1, height: 0 });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout waiting for downlink")), 8000);
      const device = mqtt.connect(url, {
        clientId: "cis_ib.SNDEMO0001",
        username: "SNDEMO0001",
        password: "demo-device-secret",
        connectTimeout: 5000,
      });
      device.on("error", (err) => {
        clearTimeout(timer);
        device.end(true);
        reject(err);
      });
      device.on("message", (gotTopic, payload) => {
        clearTimeout(timer);
        device.end(true);
        try {
          assert.equal(gotTopic, topic);
          assert.deepEqual(JSON.parse(payload.toString("utf8")), envelope);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      device.on("connect", () => {
        device.subscribe(topic, { qos: 1 }, (err) => {
          if (err) {
            clearTimeout(timer);
            device.end(true);
            reject(err);
            return;
          }
          void publishServiceInvoke({
            productKey: "cis_ib",
            sn: "SNDEMO0001",
            payload: envelope,
          }).catch((publishErr) => {
            clearTimeout(timer);
            device.end(true);
            reject(publishErr);
          });
        });
      });
    });
  } finally {
    bridge.end(true);
    await broker.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
