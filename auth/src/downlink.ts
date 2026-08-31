import type mqtt from "mqtt";
import { cisThingTopics, isValidSn, normalizeSn } from "./policy.js";

let publisher: mqtt.MqttClient | null = null;

export function attachDownlinkPublisher(client: mqtt.MqttClient): void {
  publisher = client;
}

export function buildServiceInvokeEnvelope(
  service: string,
  params: Record<string, unknown>,
): { method: "thing.service.invoke"; params: Record<string, Record<string, unknown>> } {
  return {
    method: "thing.service.invoke",
    params: { [service]: params },
  };
}

export function parseCommandBody(body: Record<string, unknown>): {
  productKey: string;
  sn: string;
  payload: { method: string; params: Record<string, unknown> };
} {
  const productKey = typeof body.productKey === "string" ? body.productKey.trim() : "";
  const sn = typeof body.sn === "string" ? normalizeSn(body.sn) : "";
  if (!/^[a-zA-Z0-9_]{2,64}$/.test(productKey)) {
    throw new DownlinkError("invalid_product", "productKey 无效");
  }
  if (!isValidSn(sn)) {
    throw new DownlinkError("invalid_sn", "SN 无效");
  }

  let payload = body.payload;
  if (payload == null && typeof body.service === "string") {
    const params = isPlainObject(body.params) ? body.params : {};
    payload = buildServiceInvokeEnvelope(body.service.trim(), params);
  }
  if (!isPlainObject(payload)) {
    throw new DownlinkError("invalid_payload", "需要 payload 或 service+params");
  }
  if (payload.method !== "thing.service.invoke") {
    throw new DownlinkError("invalid_payload", "method 必须是 thing.service.invoke");
  }
  if (!isPlainObject(payload.params) || Object.keys(payload.params).length !== 1) {
    throw new DownlinkError("invalid_payload", "一次只能下发一个服务");
  }
  return {
    productKey,
    sn,
    payload: payload as { method: string; params: Record<string, unknown> },
  };
}

export class DownlinkError extends Error {
  constructor(
    public readonly code: "invalid_product" | "invalid_sn" | "invalid_payload" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "DownlinkError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function waitConnected(client: mqtt.MqttClient, timeoutMs: number): Promise<void> {
  if (client.connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off("connect", onConnect);
      reject(new DownlinkError("unavailable", "MQTT 下行未就绪"));
    }, timeoutMs);
    const onConnect = () => {
      clearTimeout(timer);
      resolve();
    };
    client.once("connect", onConnect);
  });
}

export async function publishServiceInvoke(input: {
  productKey: string;
  sn: string;
  payload: unknown;
  timeoutMs?: number;
}): Promise<{ topic: string }> {
  if (!publisher) {
    throw new DownlinkError("unavailable", "MQTT 下行未就绪");
  }
  await waitConnected(publisher, input.timeoutMs ?? 5000);
  const sn = normalizeSn(input.sn);
  const topic = cisThingTopics(input.productKey, sn).serviceInvoke;
  const body = typeof input.payload === "string"
    ? input.payload
    : JSON.stringify(input.payload);
  await new Promise<void>((resolve, reject) => {
    publisher!.publish(topic, body, { qos: 1 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  return { topic };
}
