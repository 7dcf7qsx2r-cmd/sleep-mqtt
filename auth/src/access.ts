import { timingSafeEqual } from "node:crypto";
import { parseClientId, topicAllowed } from "./policy.js";
import type { Store } from "./store.js";

function secretsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function decideAuth(
  store: Store,
  input: { clientid?: string; username?: string; password?: string },
  bridgeSecret: string,
): Promise<{ result: "allow" | "deny"; is_superuser?: boolean }> {
  const clientid = input.clientid ?? "";
  const username = input.username ?? "";
  const password = input.password ?? "";

  if (clientid === "sleep-mqtt-bridge" && username === "bridge" && secretsEqual(password, bridgeSecret)) {
    return { result: "allow", is_superuser: true };
  }

  const parsed = parseClientId(clientid);
  if (!parsed || parsed.sn !== username) return { result: "deny" };

  const device = await store.getDevice(username);
  if (!device || device.productKey !== parsed.productKey) return { result: "deny" };
  if ((device.status ?? "active") !== "active") return { result: "deny" };
  if (!secretsEqual(device.deviceSecret, password)) return { result: "deny" };
  return { result: "allow", is_superuser: false };
}

export async function decideAcl(
  store: Store,
  input: { clientid?: string; username?: string; topic?: string; action?: string },
  bridgeSecretUser = "bridge",
): Promise<{ result: "allow" | "deny" }> {
  const clientid = input.clientid ?? "";
  const username = input.username ?? "";
  if (clientid === "sleep-mqtt-bridge" && username === bridgeSecretUser) {
    return { result: "allow" };
  }

  const parsed = parseClientId(clientid);
  if (!parsed || parsed.sn !== username) return { result: "deny" };
  const device = await store.getDevice(username);
  if (!device || device.productKey !== parsed.productKey) return { result: "deny" };
  if ((device.status ?? "active") !== "active") return { result: "deny" };

  const ok = topicAllowed({
    productKey: parsed.productKey,
    sn: parsed.sn,
    topic: input.topic ?? "",
    action: input.action ?? "",
  });
  return { result: ok ? "allow" : "deny" };
}
