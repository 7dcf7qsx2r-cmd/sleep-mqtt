import assert from "node:assert/strict";
import test from "node:test";
import { parseClientId, topicAllowed, vendorConnectParams, isValidSn, normalizeSn } from "./policy.js";

test("clientId is productKey.sn", () => {
  assert.deepEqual(parseClientId("xiaomian_mvp.SNDEMO0001"), {
    productKey: "xiaomian_mvp",
    sn: "SNDEMO0001",
  });
  assert.equal(parseClientId("bad id"), null);
});

test("device may publish only own up topics", () => {
  const base = { productKey: "xiaomian_mvp", sn: "SNDEMO0001" };
  assert.equal(topicAllowed({ ...base, action: "publish", topic: "xiaomian_mvp/SNDEMO0001/up/realtime" }), true);
  assert.equal(topicAllowed({ ...base, action: "publish", topic: "xiaomian_mvp/SNDEMO0001/down/cmd" }), false);
  assert.equal(topicAllowed({ ...base, action: "publish", topic: "xiaomian_mvp/OTHER/up/realtime" }), false);
});

test("device may subscribe only own down topics", () => {
  const base = { productKey: "xiaomian_mvp", sn: "SNDEMO0001" };
  assert.equal(topicAllowed({ ...base, action: "subscribe", topic: "xiaomian_mvp/SNDEMO0001/down/#" }), true);
  assert.equal(topicAllowed({ ...base, action: "subscribe", topic: "xiaomian_mvp/SNDEMO0001/up/realtime" }), false);
});

test("vendor connect params match asked fields", () => {
  const p = vendorConnectParams({
    productKey: "xiaomian_mvp",
    sn: "SNDEMO0001",
    deviceSecret: "secret",
  });
  assert.equal(p.clientId, "xiaomian_mvp.SNDEMO0001");
  assert.equal(p.username, "SNDEMO0001");
  assert.equal(p.password, "secret");
  assert.equal(p.tls, false);
  assert.equal(p.broker, "mqtt://127.0.0.1:1883");
});

test("vendor connect params use mqtts when tls", () => {
  const p = vendorConnectParams({
    productKey: "xiaomian_mvp",
    sn: "SNDEMO0001",
    deviceSecret: "secret",
    host: "api.xmianai.com",
    tls: true,
  });
  assert.equal(p.tls, true);
  assert.equal(p.broker, "mqtts://api.xmianai.com:8883");
});

test("sn is normalized uppercase", () => {
  assert.equal(normalizeSn("sndemo0001"), "SNDEMO0001");
  assert.equal(isValidSn("SNDEMO0001"), true);
  assert.equal(isValidSn("ab"), false);
  assert.equal(isValidSn("HELLO"), false);
});
