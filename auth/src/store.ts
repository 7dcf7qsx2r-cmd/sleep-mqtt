import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { isValidSn, normalizeSn } from "./policy.js";
import { PgStore } from "./pgStore.js";

export interface Product {
  productKey: string;
  name: string;
  createdAt: string;
}

export interface Device {
  productKey: string;
  sn: string;
  deviceSecret: string;
  createdAt: string;
  status?: string;
  lastSeenAt?: string | null;
}

export interface IngestMessage {
  id: string;
  productKey: string;
  sn: string;
  topic: string;
  payload: unknown;
  receivedAt: string;
}

export interface Store {
  readonly kind: "file" | "postgres";
  listProducts(): Promise<Product[]>;
  getProduct(productKey: string): Promise<Product | undefined>;
  createProduct(name: string, productKey?: string): Promise<Product>;
  listDevices(productKey?: string): Promise<Device[]>;
  getDevice(sn: string): Promise<Device | undefined>;
  createDevice(productKey: string, sn?: string): Promise<Device>;
  upsertSeedDevice(input: {
    productKey: string;
    productName: string;
    sn: string;
    deviceSecret: string;
  }): Promise<Device>;
  appendMessage(msg: Omit<IngestMessage, "id" | "receivedAt"> & {
    id?: string;
    receivedAt?: string;
  }): Promise<IngestMessage>;
  listMessages(sn?: string): Promise<IngestMessage[]>;
  close?(): Promise<void>;
}

interface DbFile {
  products: Product[];
  devices: Device[];
  messages: IngestMessage[];
}

const MAX_MESSAGES = 500;

function emptyDb(): DbFile {
  return { products: [], devices: [], messages: [] };
}

export class FileStore implements Store {
  readonly kind = "file" as const;

  constructor(private readonly filePath: string) {
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  private read(): DbFile {
    try {
      const raw = readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<DbFile>;
      return {
        products: Array.isArray(parsed.products) ? parsed.products : [],
        devices: Array.isArray(parsed.devices) ? parsed.devices : [],
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      };
    } catch {
      return emptyDb();
    }
  }

  private write(db: DbFile): void {
    writeFileSync(this.filePath, JSON.stringify(db, null, 2));
  }

  async listProducts(): Promise<Product[]> {
    return this.read().products;
  }

  async getProduct(productKey: string): Promise<Product | undefined> {
    return this.read().products.find((p) => p.productKey === productKey);
  }

  async createProduct(name: string, productKey?: string): Promise<Product> {
    const db = this.read();
    const key = productKey?.trim() || slugKey(name);
    if (db.products.some((p) => p.productKey === key)) {
      throw new Error(`product already exists: ${key}`);
    }
    const product: Product = {
      productKey: key,
      name: name.trim() || key,
      createdAt: new Date().toISOString(),
    };
    db.products.push(product);
    this.write(db);
    return product;
  }

  async listDevices(productKey?: string): Promise<Device[]> {
    const devices = this.read().devices;
    return productKey ? devices.filter((d) => d.productKey === productKey) : devices;
  }

  async getDevice(sn: string): Promise<Device | undefined> {
    const id = normalizeSn(sn);
    return this.read().devices.find((d) => normalizeSn(d.sn) === id);
  }

  async createDevice(productKey: string, sn?: string): Promise<Device> {
    const db = this.read();
    if (!db.products.some((p) => p.productKey === productKey)) {
      throw new Error(`unknown product: ${productKey}`);
    }
    const id = sn?.trim() ? normalizeSn(sn) : `SN${randomBytes(4).toString("hex").toUpperCase()}`;
    if (!isValidSn(id)) {
      throw new Error(`invalid sn: ${id}`);
    }
    if (db.devices.some((d) => normalizeSn(d.sn) === id)) {
      throw new Error(`device already exists: ${id}`);
    }
    const device: Device = {
      productKey,
      sn: id,
      deviceSecret: randomBytes(16).toString("hex"),
      createdAt: new Date().toISOString(),
      status: "active",
    };
    db.devices.push(device);
    this.write(db);
    return device;
  }

  async upsertSeedDevice(input: {
    productKey: string;
    productName: string;
    sn: string;
    deviceSecret: string;
  }): Promise<Device> {
    const db = this.read();
    if (!db.products.some((p) => p.productKey === input.productKey)) {
      db.products.push({
        productKey: input.productKey,
        name: input.productName,
        createdAt: new Date().toISOString(),
      });
    }
    const sn = normalizeSn(input.sn);
    const existing = db.devices.find((d) => normalizeSn(d.sn) === sn);
    if (existing) {
      existing.productKey = input.productKey;
      existing.deviceSecret = input.deviceSecret;
      existing.sn = sn;
      existing.status = existing.status ?? "active";
      this.write(db);
      return existing;
    }
    const device: Device = {
      productKey: input.productKey,
      sn,
      deviceSecret: input.deviceSecret,
      createdAt: new Date().toISOString(),
      status: "active",
    };
    db.devices.push(device);
    this.write(db);
    return device;
  }

  async appendMessage(msg: Omit<IngestMessage, "id" | "receivedAt"> & {
    id?: string;
    receivedAt?: string;
  }): Promise<IngestMessage> {
    const db = this.read();
    const saved: IngestMessage = {
      productKey: msg.productKey,
      sn: normalizeSn(msg.sn),
      topic: msg.topic,
      payload: msg.payload,
      id: msg.id ?? randomBytes(8).toString("hex"),
      receivedAt: msg.receivedAt ?? new Date().toISOString(),
    };
    db.messages.unshift(saved);
    db.messages = db.messages.slice(0, MAX_MESSAGES);
    const device = db.devices.find((d) => normalizeSn(d.sn) === saved.sn);
    if (device) device.lastSeenAt = saved.receivedAt;
    this.write(db);
    return saved;
  }

  async listMessages(sn?: string): Promise<IngestMessage[]> {
    const messages = this.read().messages;
    if (!sn) return messages;
    const id = normalizeSn(sn);
    return messages.filter((m) => normalizeSn(m.sn) === id);
  }

  snapshot(): DbFile {
    return this.read();
  }
}

export function defaultFileStore(dataDir = process.env.DATA_DIR ?? join(process.cwd(), "..", "data")): FileStore {
  return new FileStore(join(dataDir, "store.json"));
}

/** @deprecated use openStore / defaultFileStore */
export function defaultStore(dataDir?: string): FileStore {
  return defaultFileStore(dataDir);
}

export async function openStore(): Promise<Store> {
  const url = process.env.DATABASE_URL?.trim();
  if (url && url !== "pglite") {
    const pg = new PgStore(url);
    await pg.migrate();
    const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "..", "data");
    await pg.importFromJsonFileIfEmpty(join(dataDir, "store.json"));
    console.log("[store] postgres");
    return pg;
  }
  console.log("[store] json file (set DATABASE_URL to persist in Postgres)");
  return defaultFileStore();
}

function slugKey(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return slug || `p_${randomBytes(3).toString("hex")}`;
}
