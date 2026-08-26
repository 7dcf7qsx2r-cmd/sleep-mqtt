import { existsSync, readFileSync } from "node:fs";
import pg from "pg";
import { isValidSn, normalizeSn } from "./policy.js";
import { IOT_MIGRATION_STATEMENTS } from "./schema.js";
import { randomBytes } from "node:crypto";
import type { Device, IngestMessage, Product, Store } from "./store.js";

const { Pool } = pg;

function toJsonb(payload: unknown): string {
  if (payload !== null && typeof payload === "object") return JSON.stringify(payload);
  return JSON.stringify({ value: payload });
}

function fromJsonb(value: unknown): unknown {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return { value };
    }
  }
  return value;
}

export class PgStore implements Store {
  readonly kind = "postgres" as const;
  private readonly pool: pg.Pool;
  private deviceCache = new Map<string, { at: number; device: Device | undefined }>();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 8 });
  }

  async migrate(): Promise<void> {
    for (const sql of IOT_MIGRATION_STATEMENTS) {
      await this.pool.query(sql);
    }
  }

  async importFromJsonFileIfEmpty(filePath: string): Promise<void> {
    const { rows } = await this.pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM iot_devices");
    if (Number(rows[0]?.n ?? "0") > 0) return;
    if (!existsSync(filePath)) return;
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
        products?: Product[];
        devices?: Device[];
        messages?: IngestMessage[];
      };
      for (const product of parsed.products ?? []) {
        await this.pool.query(
          `INSERT INTO iot_products (product_key, name, created_at)
           VALUES ($1, $2, $3::timestamptz)
           ON CONFLICT (product_key) DO NOTHING`,
          [product.productKey, product.name, product.createdAt],
        );
      }
      for (const device of parsed.devices ?? []) {
        await this.upsertSeedDevice({
          productKey: device.productKey,
          productName: device.productKey,
          sn: device.sn,
          deviceSecret: device.deviceSecret,
        });
      }
      const chronological = [...(parsed.messages ?? [])].reverse();
      for (const msg of chronological) {
        await this.appendMessage({
          productKey: msg.productKey,
          sn: msg.sn,
          topic: msg.topic,
          payload: msg.payload,
          receivedAt: msg.receivedAt,
        });
      }
      console.log("[store] imported json file into postgres");
    } catch (err) {
      console.warn("[store] json import skipped", err instanceof Error ? err.message : err);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listProducts(): Promise<Product[]> {
    const { rows } = await this.pool.query<{ product_key: string; name: string; created_at: Date }>(
      `SELECT product_key, name, created_at FROM iot_products ORDER BY created_at ASC`,
    );
    return rows.map((r) => ({
      productKey: r.product_key,
      name: r.name,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async getProduct(productKey: string): Promise<Product | undefined> {
    const { rows } = await this.pool.query<{ product_key: string; name: string; created_at: Date }>(
      `SELECT product_key, name, created_at FROM iot_products WHERE product_key = $1`,
      [productKey],
    );
    const r = rows[0];
    if (!r) return undefined;
    return { productKey: r.product_key, name: r.name, createdAt: r.created_at.toISOString() };
  }

  async createProduct(name: string, productKey?: string): Promise<Product> {
    const key = productKey?.trim() || name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `p_${randomBytes(3).toString("hex")}`;
    try {
      const { rows } = await this.pool.query<{ product_key: string; name: string; created_at: Date }>(
        `INSERT INTO iot_products (product_key, name) VALUES ($1, $2)
         RETURNING product_key, name, created_at`,
        [key, name.trim() || key],
      );
      const r = rows[0];
      return { productKey: r.product_key, name: r.name, createdAt: r.created_at.toISOString() };
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      if (code === "23505") throw new Error(`product already exists: ${key}`);
      throw err;
    }
  }

  async listDevices(productKey?: string): Promise<Device[]> {
    const { rows } = productKey
      ? await this.pool.query<DeviceRow>(
        `SELECT sn, product_key, device_secret, status, last_seen_at, created_at
         FROM iot_devices WHERE product_key = $1 ORDER BY created_at ASC`,
        [productKey],
      )
      : await this.pool.query<DeviceRow>(
        `SELECT sn, product_key, device_secret, status, last_seen_at, created_at
         FROM iot_devices ORDER BY created_at ASC`,
      );
    return rows.map(mapDevice);
  }

  async getDevice(sn: string): Promise<Device | undefined> {
    const id = normalizeSn(sn);
    const cached = this.deviceCache.get(id);
    if (cached && Date.now() - cached.at < 10_000) return cached.device;
    const { rows } = await this.pool.query<DeviceRow>(
      `SELECT sn, product_key, device_secret, status, last_seen_at, created_at
       FROM iot_devices WHERE sn = $1`,
      [id],
    );
    const device = rows[0] ? mapDevice(rows[0]) : undefined;
    this.deviceCache.set(id, { at: Date.now(), device });
    return device;
  }

  async createDevice(productKey: string, sn?: string): Promise<Device> {
    const product = await this.getProduct(productKey);
    if (!product) throw new Error(`unknown product: ${productKey}`);
    const id = sn?.trim() ? normalizeSn(sn) : `SN${randomBytes(4).toString("hex").toUpperCase()}`;
    if (!isValidSn(id)) throw new Error(`invalid sn: ${id}`);
    try {
      const { rows } = await this.pool.query<DeviceRow>(
        `INSERT INTO iot_devices (sn, product_key, device_secret, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING sn, product_key, device_secret, status, last_seen_at, created_at`,
        [id, productKey, randomBytes(16).toString("hex")],
      );
      this.deviceCache.delete(id);
      return mapDevice(rows[0]!);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      if (code === "23505") throw new Error(`device already exists: ${id}`);
      throw err;
    }
  }

  async upsertSeedDevice(input: {
    productKey: string;
    productName: string;
    sn: string;
    deviceSecret: string;
  }): Promise<Device> {
    const sn = normalizeSn(input.sn);
    await this.pool.query(
      `INSERT INTO iot_products (product_key, name) VALUES ($1, $2)
       ON CONFLICT (product_key) DO UPDATE SET name = EXCLUDED.name`,
      [input.productKey, input.productName],
    );
    const { rows } = await this.pool.query<DeviceRow>(
      `INSERT INTO iot_devices (sn, product_key, device_secret, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (sn) DO UPDATE SET
         product_key = EXCLUDED.product_key,
         device_secret = EXCLUDED.device_secret,
         status = 'active'
       RETURNING sn, product_key, device_secret, status, last_seen_at, created_at`,
      [sn, input.productKey, input.deviceSecret],
    );
    this.deviceCache.delete(sn);
    return mapDevice(rows[0]!);
  }

  async appendMessage(msg: Omit<IngestMessage, "id" | "receivedAt"> & {
    id?: string;
    receivedAt?: string;
  }): Promise<IngestMessage> {
    const sn = normalizeSn(msg.sn);
    const receivedAt = msg.receivedAt ?? new Date().toISOString();
    const raw = toJsonb(msg.payload);
    const { rows } = await this.pool.query<{ id: string; received_at: Date }>(
      `INSERT INTO iot_messages (product_key, sn, topic, raw_json, received_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       RETURNING id::text, received_at`,
      [msg.productKey, sn, msg.topic, raw, receivedAt],
    );
    await this.pool.query(
      `INSERT INTO iot_messages_latest (sn, topic, product_key, raw_json, received_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       ON CONFLICT (sn, topic) DO UPDATE SET
         product_key = EXCLUDED.product_key,
         raw_json = EXCLUDED.raw_json,
         received_at = EXCLUDED.received_at`,
      [sn, msg.topic, msg.productKey, raw, receivedAt],
    );
    await this.pool.query(
      `UPDATE iot_devices SET last_seen_at = $2::timestamptz WHERE sn = $1`,
      [sn, receivedAt],
    );
    const cached = this.deviceCache.get(sn);
    if (cached?.device) {
      cached.device.lastSeenAt = receivedAt;
      cached.at = Date.now();
    }
    return {
      id: rows[0]?.id ?? randomBytes(8).toString("hex"),
      productKey: msg.productKey,
      sn,
      topic: msg.topic,
      payload: msg.payload,
      receivedAt: rows[0]?.received_at.toISOString() ?? receivedAt,
    };
  }

  async listMessages(sn?: string): Promise<IngestMessage[]> {
    const { rows } = sn
      ? await this.pool.query<MessageRow>(
        `SELECT id::text, product_key, sn, topic, raw_json, received_at
         FROM iot_messages WHERE sn = $1
         ORDER BY received_at DESC LIMIT 200`,
        [normalizeSn(sn)],
      )
      : await this.pool.query<MessageRow>(
        `SELECT id::text, product_key, sn, topic, raw_json, received_at
         FROM iot_messages ORDER BY received_at DESC LIMIT 200`,
      );
    return rows.map((r) => ({
      id: r.id,
      productKey: r.product_key,
      sn: r.sn,
      topic: r.topic,
      payload: fromJsonb(r.raw_json),
      receivedAt: r.received_at.toISOString(),
    }));
  }
}

interface DeviceRow {
  sn: string;
  product_key: string;
  device_secret: string;
  status: string | null;
  last_seen_at: Date | null;
  created_at: Date;
}

interface MessageRow {
  id: string;
  product_key: string;
  sn: string;
  topic: string;
  raw_json: unknown;
  received_at: Date;
}

function mapDevice(row: DeviceRow): Device {
  return {
    sn: row.sn,
    productKey: row.product_key,
    deviceSecret: row.device_secret,
    status: row.status ?? "active",
    lastSeenAt: row.last_seen_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}
