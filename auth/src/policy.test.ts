import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  parseClientId,
  parseConnectIdentity,
  parseTopicIdentity,
  topicAllowed,
  vendorConnectParams,
  cisThingTopics,
  isValidSn,
  normalizeSn,
  hmacDevicePassword,
  productAuthMatches,
} from "./policy.js";

test("clientId is productKey.sn", () => {
  assert.deepEqual(parseClientId("xiaomian_mvp.SNDEMO0001"), {
    productKey: "xiaomian_mvp",
    sn: "SNDEMO0001",
  });
  assert.deepEqual(parseClientId("cis_ib.snabc123|securemode=2,signmethod=hmacsha256|"), {
    productKey: "cis_ib",
    sn: "SNABC123",
  });
  assert.equal(parseClientId("bad id"), null);
});

test("username can be sn or sn&productKey", () => {
  assert.deepEqual(parseConnectIdentity("cis_ib.SNABC123", "SNABC123"), {
    productKey: "cis_ib",
    sn: "SNABC123",
  });
  assert.deepEqual(parseConnectIdentity("cis_ib.SNABC123", "SNABC123&cis_ib"), {
    productKey: "cis_ib",
    sn: "SNABC123",
  });
  assert.equal(parseConnectIdentity("cis_ib.SNABC123", "SNABC123&cis_ip"), null);
});

test("device may only use topics scoped to own productKey and sn", () => {
  const base = { productKey: "cis_ib", sn: "SNABC123" };
  assert.equal(topicAllowed({ ...base, action: "publish", topic: "cis_ib/SNABC123/up/realtime" }), true);
  assert.equal(topicAllowed({ ...base, action: "publish", topic: "/cis_ib/SNABC123/user/update" }), true);
  assert.equal(topicAllowed({ ...base, action: "publish", topic: "sys/cis_ib/SNABC123/thing/event/property/post" }), true);
  assert.equal(topicAllowed({ ...base, action: "publish", topic: "cis_ib/OTHER/up/realtime" }), false);
  assert.equal(topicAllowed({ ...base, action: "subscribe", topic: "cis_ib/SNABC123/#" }), true);
  assert.equal(topicAllowed({ ...base, action: "subscribe", topic: "/cis_ib/SNABC123/user/get" }), true);
  assert.equal(topicAllowed({ ...base, action: "subscribe", topic: "cis_ib/OTHER/#" }), false);
});

test("IB43 sys thing topics match vendor macros", () => {
  const pk = "cis_ib";
  const sn = "744DBD7785D4";
  const topics = cisThingTopics(pk, sn);
  assert.equal(topics.otaUpgrade, "/sys/cis_ib/744DBD7785D4/thing/ota/upgrade");
  assert.equal(topics.serviceInvoke, "/sys/cis_ib/744DBD7785D4/thing/service/invoke");
  assert.equal(topics.propertyPost, "/sys/cis_ib/744DBD7785D4/thing/property/post");
  assert.equal(topics.otaProgress, "/sys/cis_ib/744DBD7785D4/thing/ota/progress");
  const base = { productKey: pk, sn };
  assert.equal(topicAllowed({ ...base, action: "subscribe", topic: topics.otaUpgrade }), true);
  assert.equal(topicAllowed({ ...base, action: "subscribe", topic: topics.serviceInvoke }), true);
  assert.equal(topicAllowed({ ...base, action: "publish", topic: topics.propertyPost }), true);
  assert.equal(topicAllowed({ ...base, action: "publish", topic: topics.otaProgress }), true);
  assert.deepEqual(parseTopicIdentity(topics.propertyPost), { productKey: pk, sn });
  assert.equal(topicAllowed({ ...base, action: "publish", topic: `/sys/${pk}/OTHER/thing/property/post` }), false);
});

test("one-type-one-secret hmac matches", () => {
  const secret = "lab-cis_ib-secret";
  const hmac = hmacDevicePassword(secret, "cis_ib", "SNABC123");
  assert.equal(productAuthMatches(secret, "cis_ib", "SNABC123", hmac), true);
  assert.equal(productAuthMatches(secret, "cis_ib", "SNABC123", secret), true);
  assert.equal(productAuthMatches(secret, "cis_ib", "SNABC123", "nope"), false);
});

test("hmac accepts mixed-case MAC username", () => {
  const secret = "lab-cis_ib-secret";
  const mixed = "744dbd7785d4";
  const hmacUpper = hmacDevicePassword(secret, "cis_ib", mixed);
  const hmacRaw = createHmac("sha256", secret).update(`cis_ib.${mixed}`).digest("hex");
  assert.equal(productAuthMatches(secret, "cis_ib", mixed, hmacUpper), true);
  assert.equal(productAuthMatches(secret, "cis_ib", "744DBD7785D4", hmacRaw, mixed), true);
});

test("vendor connect params match asked fields", () => {
  const p = vendorConnectParams({
    productKey: "cis_ib",
    sn: "SNDEMO0001",
    deviceSecret: "secret",
  });
  assert.equal(p.clientId, "cis_ib.SNDEMO0001");
  assert.equal(p.username, "SNDEMO0001");
  assert.equal(p.password, "secret");
  assert.equal(p.tls, false);
  assert.equal(p.broker, "mqtt://127.0.0.1:1883");
  assert.equal(p.publishTopic, "/sys/cis_ib/SNDEMO0001/thing/property/post");
});

test("vendor connect params use mqtts when tls", () => {
  const p = vendorConnectParams({
    productKey: "cis_ib",
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
  assert.equal(isValidSn("744DBD7785D4"), true);
  assert.equal(isValidSn("ab"), false);
  assert.equal(isValidSn("HELLO"), false);
});
