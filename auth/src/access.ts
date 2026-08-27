import { parseConnectIdentity, productAuthMatches, topicAllowed } from "./policy.js";
import { timingSafeEqual } from "node:crypto";
import type { Store } from "./store.js";

function secretsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function credentialString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return String(value);
}

export async function decideAuth(
  store: Store,
  input: { clientid?: string; username?: string; password?: string },
  bridgeSecret: string,
): Promise<{ result: "allow" | "deny"; is_superuser?: boolean }> {
  const clientid = credentialString(input.clientid);
  const username = credentialString(input.username);
  const password = credentialString(input.password);

  try {
    if (clientid === "sleep-mqtt-bridge" && username === "bridge" && secretsEqual(password, bridgeSecret)) {
      return { result: "allow", is_superuser: true };
    }

    const parsed = parseConnectIdentity(clientid, username);
    if (!parsed) {
      console.warn("[auth] deny identity", clientid, username);
      return { result: "deny" };
    }

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
        console.warn("[auth] deny sn product mismatch", parsed.sn, existing.productKey, parsed.productKey);
        return { result: "deny" };
      }
      try {
        await store.ensureDevice({
          productKey: parsed.productKey,
          sn: parsed.sn,
          deviceSecret: password,
        });
      } catch (err) {
        console.warn("[auth] deny ensureDevice", parsed.sn, err instanceof Error ? err.message : err);
        return { result: "deny" };
      }
      return { result: "allow", is_superuser: false };
    }

    const device = await store.getDevice(parsed.sn);
    if (!device || device.productKey !== parsed.productKey) {
      console.warn("[auth] deny unknown device", parsed.productKey, parsed.sn, "hasProductSecret", Boolean(product?.productSecret));
      return { result: "deny" };
    }
    if ((device.status ?? "active") !== "active") {
      console.warn("[auth] deny inactive", parsed.sn);
      return { result: "deny" };
    }
    if (!secretsEqual(device.deviceSecret, password)) {
      console.warn("[auth] deny bad password", parsed.sn);
      return { result: "deny" };
    }
    return { result: "allow", is_superuser: false };
  } catch (err) {
    console.warn("[auth] deny exception", err instanceof Error ? err.message : err);
    return { result: "deny" };
  }
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
