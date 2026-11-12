import { isValidSn, normalizeSn } from "./policy.js";
import type { Store } from "./store.js";

export const BR_MATTRESS_PRODUCT_KEY = "br_mattress";

export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestError";
  }
}

export interface DeviceReport {
  productKey: string;
  productName: string;
  sn: string;
  topic: string;
  payload: unknown;
}

export function parseIngestBody(body: unknown): DeviceReport {
  const raw = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const productKey = typeof raw.productKey === "string" ? raw.productKey.trim() : "";
  const productName = typeof raw.productName === "string" && raw.productName.trim()
    ? raw.productName.trim()
    : productKey;
  const sn = typeof raw.sn === "string" ? normalizeSn(raw.sn) : "";
  const topic = typeof raw.topic === "string" ? raw.topic.trim() : "";
  if (!/^[a-zA-Z0-9_]{2,64}$/.test(productKey)) throw new IngestError("productKey 无效");
  if (!isValidSn(sn)) throw new IngestError("sn 无效");
  const prefix = `/sys/${productKey}/${sn}/thing/`;
  if (!topic.startsWith(prefix)) throw new IngestError("topic 与设备不匹配");
  if (raw.payload === undefined) throw new IngestError("payload 必填");
  return { productKey, productName, sn, topic, payload: raw.payload };
}

/** 登记产品与设备，并把厂家原文写入平台消息。设备已属于别的产品时拒绝。 */
export async function acceptDeviceReport(store: Store, body: unknown): Promise<DeviceReport> {
  const report = parseIngestBody(body);
  const product = await store.getProduct(report.productKey);
  if (!product) {
    await store.ensureProduct({
      productKey: report.productKey,
      name: report.productName,
      productSecret: `lab-${report.productKey}-secret`,
    });
  }
  const existing = await store.getDevice(report.sn);
  if (existing && existing.productKey !== report.productKey) {
    throw new IngestError(`序列号已登记在 ${existing.productKey}`);
  }
  if (!existing) {
    await store.createDevice(report.productKey, report.sn);
  }
  await store.appendMessage({
    productKey: report.productKey,
    sn: report.sn,
    topic: report.topic,
    payload: report.payload,
  });
  return report;
}
