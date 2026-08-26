import { parseClientId, topicAllowed } from "./policy.js";
import type { FileStore } from "./store.js";

export function decideAuth(
  store: FileStore,
  input: { clientid?: string; username?: string; password?: string },
  bridgeSecret: string,
): { result: "allow" | "deny"; is_superuser?: boolean } {
  const clientid = input.clientid ?? "";
  const username = input.username ?? "";
  const password = input.password ?? "";

  if (clientid === "sleep-mqtt-bridge" && username === "bridge" && password === bridgeSecret) {
    return { result: "allow", is_superuser: true };
  }

  const parsed = parseClientId(clientid);
  if (!parsed || parsed.sn !== username) return { result: "deny" };

  const device = store.getDevice(username);
  if (!device || device.productKey !== parsed.productKey) return { result: "deny" };
  if (device.deviceSecret !== password) return { result: "deny" };
  return { result: "allow", is_superuser: false };
}

export function decideAcl(
  store: FileStore,
  input: { clientid?: string; username?: string; topic?: string; action?: string },
  bridgeSecretUser = "bridge",
): { result: "allow" | "deny" } {
  const clientid = input.clientid ?? "";
  const username = input.username ?? "";
  if (clientid === "sleep-mqtt-bridge" && username === bridgeSecretUser) {
    return { result: "allow" };
  }

  const parsed = parseClientId(clientid);
  if (!parsed || parsed.sn !== username) return { result: "deny" };
  const device = store.getDevice(username);
  if (!device || device.productKey !== parsed.productKey) return { result: "deny" };

  const ok = topicAllowed({
    productKey: parsed.productKey,
    sn: parsed.sn,
    topic: input.topic ?? "",
    action: input.action ?? "",
  });
  return { result: ok ? "allow" : "deny" };
}
