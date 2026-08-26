export type MqttAction = "publish" | "subscribe";

export function normalizeSn(input: string): string {
  return input.trim().toUpperCase();
}

export function isValidSn(input: string): boolean {
  const sn = normalizeSn(input);
  return /^[A-Z0-9][A-Z0-9_-]{5,63}$/.test(sn) && /[0-9]/.test(sn);
}

export function parseClientId(clientId: string): { productKey: string; sn: string } | null {
  const m = /^([a-zA-Z0-9_]+)\.([A-Za-z0-9_-]+)$/.exec(clientId.trim());
  if (!m) return null;
  return { productKey: m[1], sn: m[2] };
}

export function upTopicPrefix(productKey: string, sn: string): string {
  return `${productKey}/${sn}/up/`;
}

export function downTopicPrefix(productKey: string, sn: string): string {
  return `${productKey}/${sn}/down/`;
}

export function topicAllowed(input: {
  productKey: string;
  sn: string;
  topic: string;
  action: string;
}): boolean {
  const topic = input.topic.trim();
  const action = input.action.toLowerCase();
  const up = upTopicPrefix(input.productKey, input.sn);
  const down = downTopicPrefix(input.productKey, input.sn);
  const downHash = `${input.productKey}/${input.sn}/down/#`;
  const downPlus = `${input.productKey}/${input.sn}/down/+`;

  if (action === "publish") {
    return topic.startsWith(up);
  }
  if (action === "subscribe") {
    return topic === downHash || topic === downPlus || topic.startsWith(down);
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
  return {
    productKey: input.productKey,
    broker: `${scheme}://${host}:${port}`,
    tls,
    clientId: `${input.productKey}.${input.sn}`,
    username: input.sn,
    password: input.deviceSecret,
    publishTopic: `${input.productKey}/${input.sn}/up/realtime`,
    subscribeTopic: `${input.productKey}/${input.sn}/down/#`,
  };
}
