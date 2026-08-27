import { createHmac, timingSafeEqual } from "node:crypto";

export type MqttAction = "publish" | "subscribe";

export function normalizeSn(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidSn(input: string): boolean {
  const sn = normalizeSn(input);
  return /^[A-Z0-9][A-Z0-9_-]{5,63}$/.test(sn) && /[0-9]/.test(sn);
}

function equalUtf8(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** clientId = {productKey}.{sn}，兼容阿里云后缀 `|securemode=...|` */
export function parseClientId(clientId: string): { productKey: string; sn: string } | null {
  const raw = clientId.trim().split("|")[0]?.trim() ?? "";
  const m = /^([a-zA-Z0-9_]+)\.([A-Za-z0-9_-]+)$/.exec(raw);
  if (!m) return null;
  return { productKey: m[1], sn: normalizeSn(m[2]) };
}

/** username 可为 sn，或阿里云风格 sn&productKey */
export function parseConnectIdentity(
  clientId: string,
  username: string,
): { productKey: string; sn: string } | null {
  const user = username.trim();
  if (user.includes("&")) {
    const [snPart, pkPart] = user.split("&");
    const sn = normalizeSn(snPart ?? "");
    const productKey = (pkPart ?? "").trim();
    if (!productKey || !isValidSn(sn)) return null;
    const fromId = parseClientId(clientId);
    if (fromId && (fromId.productKey !== productKey || fromId.sn !== sn)) return null;
    return { productKey, sn };
  }
  const parsed = parseClientId(clientId);
  if (!parsed || parsed.sn !== normalizeSn(user)) return null;
  return parsed;
}

export function hmacDevicePassword(productSecret: string, productKey: string, sn: string): string {
  return createHmac("sha256", productSecret)
    .update(`${productKey}.${normalizeSn(sn)}`)
    .digest("hex");
}

function hmacWithSn(productSecret: string, productKey: string, sn: string): string {
  return createHmac("sha256", productSecret)
    .update(`${productKey}.${sn}`)
    .digest("hex");
}

/** 一型一密：HMAC(productSecret, productKey.sn) 或直接使用 productSecret（联调） */
export function productAuthMatches(
  productSecret: string,
  productKey: string,
  sn: string,
  password: string,
  usernameRaw?: string,
): boolean {
  const pass = password.trim();
  if (!pass) return false;
  const variants = new Set<string>([normalizeSn(sn), sn.trim()]);
  const userSn = (usernameRaw ?? "").trim().split("&")[0]?.trim();
  if (userSn) variants.add(userSn);
  const lower = pass.toLowerCase();
  for (const variant of variants) {
    if (!variant) continue;
    if (equalUtf8(hmacWithSn(productSecret, productKey, variant), lower)) return true;
  }
  return equalUtf8(productSecret, pass);
}

export function upTopicPrefix(productKey: string, sn: string): string {
  return `${productKey}/${sn}/up/`;
}

export function downTopicPrefix(productKey: string, sn: string): string {
  return `${productKey}/${sn}/down/`;
}

function topicParts(topic: string): string[] {
  return topic.trim().replace(/^\/+/, "").split("/").filter(Boolean);
}

/** 从物模型 Topic 抽出 productKey/sn：/{pk}/{sn}/... 或 sys/{pk}/{sn}/... */
export function parseTopicIdentity(topic: string): { productKey: string; sn: string } | null {
  const parts = topicParts(topic);
  const start = parts[0] === "sys" ? 1 : 0;
  const productKey = parts[start];
  const snPart = parts[start + 1];
  if (!productKey || !snPart || snPart === "+" || snPart === "#") return null;
  if (!isValidSn(snPart)) return null;
  return { productKey, sn: normalizeSn(snPart) };
}

function topicScopedToDevice(topic: string, productKey: string, sn: string): { ok: boolean; rest: string[] } {
  const parts = topicParts(topic);
  const start = parts[0] === "sys" ? 1 : 0;
  if (parts.length < start + 2) return { ok: false, rest: [] };
  const pk = parts[start];
  const id = parts[start + 1];
  if (pk !== productKey) return { ok: false, rest: [] };
  if (!id || id === "+" || id === "#") return { ok: false, rest: [] };
  if (normalizeSn(id) !== sn) return { ok: false, rest: [] };
  return { ok: true, rest: parts.slice(start + 2) };
}

/** IB43 物模型：/sys/{productKey}/{sn}/thing/... */
export function cisThingTopics(productKey: string, sn: string) {
  const id = normalizeSn(sn);
  const root = `/sys/${productKey}/${id}/thing`;
  return {
    propertyPost: `${root}/property/post`,
    otaProgress: `${root}/ota/progress`,
    otaUpgrade: `${root}/ota/upgrade`,
    serviceInvoke: `${root}/service/invoke`,
    thingHash: `${root}/#`,
  };
}

export function topicAllowed(input: {
  productKey: string;
  sn: string;
  topic: string;
  action: string;
}): boolean {
  const action = input.action.toLowerCase();
  const sn = normalizeSn(input.sn);
  const scoped = topicScopedToDevice(input.topic, input.productKey, sn);
  if (!scoped.ok) return false;

  if (action === "publish") {
    if (input.topic.includes("+") || input.topic.includes("#")) return false;
    return true;
  }
  if (action === "subscribe") {
    return true;
  }
  return false;
}

export function vendorConnectParams(input: {
  productKey: string;
  sn: string;
  deviceSecret: string;
  host?: string;
  port?: number;
  tls?: boolean;
}) {
  const host = input.host ?? "127.0.0.1";
  const tls = input.tls === true;
  const port = input.port ?? (tls ? 8883 : 1883);
  const scheme = tls ? "mqtts" : "mqtt";
  const sn = normalizeSn(input.sn);
  const topics = cisThingTopics(input.productKey, sn);
  return {
    productKey: input.productKey,
    broker: `${scheme}://${host}:${port}`,
    tls,
    clientId: `${input.productKey}.${sn}`,
    username: sn,
    password: input.deviceSecret,
    publishTopic: topics.propertyPost,
    subscribeTopic: topics.thingHash,
    topics,
  };
}
