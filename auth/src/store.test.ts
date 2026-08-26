import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { decideAcl, decideAuth } from "./access.js";
import { FileStore } from "./store.js";

test("auth allows seeded device and denies wrong password", () => {
  const dir = mkdtempSync(join(tmpdir(), "sleep-mqtt-"));
  const store = new FileStore(join(dir, "store.json"));
  store.upsertSeedDevice({
    productKey: "xiaomian_mvp",
    productName: "mvp",
    sn: "SNDEMO0001",
    deviceSecret: "demo-device-secret",
  });
  assert.equal(decideAuth(store, {
    clientid: "xiaomian_mvp.SNDEMO0001",
    username: "SNDEMO0001",
    password: "demo-device-secret",
  }, "bridge").result, "allow");
  assert.equal(decideAuth(store, {
    clientid: "xiaomian_mvp.SNDEMO0001",
    username: "SNDEMO0001",
    password: "nope",
  }, "bridge").result, "deny");
  assert.equal(decideAuth(store, {
    clientid: "sleep-mqtt-bridge",
    username: "bridge",
    password: "bridge",
  }, "bridge").result, "allow");
  rmSync(dir, { recursive: true, force: true });
});

test("acl denies publishing to another device", () => {
  const dir = mkdtempSync(join(tmpdir(), "sleep-mqtt-"));
  const store = new FileStore(join(dir, "store.json"));
  store.upsertSeedDevice({
    productKey: "xiaomian_mvp",
    productName: "mvp",
    sn: "SNDEMO0001",
    deviceSecret: "demo-device-secret",
  });
  assert.equal(decideAcl(store, {
    clientid: "xiaomian_mvp.SNDEMO0001",
    username: "SNDEMO0001",
    topic: "xiaomian_mvp/OTHER/up/realtime",
    action: "publish",
  }).result, "deny");
  rmSync(dir, { recursive: true, force: true });
});
