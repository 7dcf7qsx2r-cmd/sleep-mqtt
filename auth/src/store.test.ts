import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decideAcl, decideAuth } from "./access.js";
import { FileStore } from "./store.js";

test("auth allows seeded device and denies wrong password", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sleep-mqtt-"));
  const store = new FileStore(join(dir, "store.json"));
  await store.upsertSeedDevice({
    productKey: "xiaomian_mvp",
    productName: "mvp",
    sn: "SNDEMO0001",
    deviceSecret: "demo-device-secret",
  });
  assert.equal((await decideAuth(store, {
    clientid: "xiaomian_mvp.SNDEMO0001",
    username: "SNDEMO0001",
    password: "demo-device-secret",
  }, "bridge")).result, "allow");
  assert.equal((await decideAuth(store, {
    clientid: "xiaomian_mvp.SNDEMO0001",
    username: "SNDEMO0001",
    password: "nope",
  }, "bridge")).result, "deny");
  assert.equal((await decideAuth(store, {
    clientid: "sleep-mqtt-bridge",
    username: "bridge",
    password: "bridge",
  }, "bridge")).result, "allow");
  rmSync(dir, { recursive: true, force: true });
});

test("acl denies publishing to another device", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sleep-mqtt-"));
  const store = new FileStore(join(dir, "store.json"));
  await store.upsertSeedDevice({
    productKey: "xiaomian_mvp",
    productName: "mvp",
    sn: "SNDEMO0001",
    deviceSecret: "demo-device-secret",
  });
  assert.equal((await decideAcl(store, {
    clientid: "xiaomian_mvp.SNDEMO0001",
    username: "SNDEMO0001",
    topic: "xiaomian_mvp/OTHER/up/realtime",
    action: "publish",
  })).result, "deny");
  rmSync(dir, { recursive: true, force: true });
});

test("ingest stores raw payload and lastSeen", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sleep-mqtt-"));
  const store = new FileStore(join(dir, "store.json"));
  await store.upsertSeedDevice({
    productKey: "xiaomian_mvp",
    productName: "mvp",
    sn: "sndemo0001",
    deviceSecret: "demo-device-secret",
  });
  const saved = await store.appendMessage({
    productKey: "xiaomian_mvp",
    sn: "sndemo0001",
    topic: "xiaomian_mvp/SNDEMO0001/up/realtime",
    payload: { demo: true },
  });
  assert.equal(saved.sn, "SNDEMO0001");
  const listed = await store.listMessages("sndemo0001");
  assert.equal((listed[0]?.payload as { demo?: boolean })?.demo, true);
  const device = await store.getDevice("sndemo0001");
  assert.ok(device?.lastSeenAt);
  rmSync(dir, { recursive: true, force: true });
});

test("product secret auto-registers unseen sn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sleep-mqtt-"));
  const store = new FileStore(join(dir, "store.json"));
  await store.ensureProduct({
    productKey: "cis_ib",
    name: "CIS-IB",
    productSecret: "lab-cis_ib-secret",
  });
  const { hmacDevicePassword } = await import("./policy.js");
  const password = hmacDevicePassword("lab-cis_ib-secret", "cis_ib", "SNNEW0001");
  assert.equal((await decideAuth(store, {
    clientid: "cis_ib.SNNEW0001",
    username: "SNNEW0001",
    password,
  }, "bridge")).result, "allow");
  const created = await store.getDevice("SNNEW0001");
  assert.equal(created?.productKey, "cis_ib");
  assert.equal((await decideAcl(store, {
    clientid: "cis_ib.SNNEW0001",
    username: "SNNEW0001",
    topic: "/cis_ib/SNNEW0001/user/update",
    action: "publish",
  })).result, "allow");
  rmSync(dir, { recursive: true, force: true });
});
