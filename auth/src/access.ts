import { parseConnectIdentity, productAuthMatches, topicAllowed } from "./policy.js";
import { timingSafeEqual } from "node:crypto";
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

  const parsed = parseConnectIdentity(clientid, username);
  if (!parsed) return { result: "deny" };

    const product = await store.getProduct(parsed.productKey);
  if (product?.productSecret && productAuthMatches(
    product.productSecret,
    parsed.productKey,
    parsed.sn,
    password,
    username,
  )) {
    const existing = await store.getDevice(parsed.sn);
    if (existing && existing.productKey !== parsed.productKey) {
      return { result: "deny" };
    }
    try {
      await store.ensureDevice({
        productKey: parsed.productKey,
        sn: parsed.sn,
        deviceSecret: password,
      });
    } catch {
      return { result: "deny" };
    }
    return { result: "allow", is_superuser: false };
  }

  const device = await store.getDevice(parsed.sn);
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

  const parsed = parseConnectIdentity(clientid, username);
  if (!parsed) return { result: "deny" };
  const device = await store.getDevice(parsed.sn);
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
