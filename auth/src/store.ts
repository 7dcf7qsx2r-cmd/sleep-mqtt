import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

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
}

export interface IngestMessage {
  id: string;
  productKey: string;
  sn: string;
  topic: string;
  payload: unknown;
  receivedAt: string;
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

export class FileStore {
  constructor(private readonly filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
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

  listProducts(): Product[] {
    return this.read().products;
  }

  getProduct(productKey: string): Product | undefined {
    return this.read().products.find((p) => p.productKey === productKey);
  }

  createProduct(name: string, productKey?: string): Product {
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

  listDevices(productKey?: string): Device[] {
    const devices = this.read().devices;
    return productKey ? devices.filter((d) => d.productKey === productKey) : devices;
  }

  getDevice(sn: string): Device | undefined {
    return this.read().devices.find((d) => d.sn === sn);
  }

  createDevice(productKey: string, sn?: string): Device {
    const db = this.read();
    if (!db.products.some((p) => p.productKey === productKey)) {
      throw new Error(`unknown product: ${productKey}`);
    }
    const id = sn?.trim() || `SN${randomBytes(4).toString("hex").toUpperCase()}`;
    if (db.devices.some((d) => d.sn === id)) {
      throw new Error(`device already exists: ${id}`);
    }
    const device: Device = {
      productKey,
      sn: id,
      deviceSecret: randomBytes(16).toString("hex"),
      createdAt: new Date().toISOString(),
    };
    db.devices.push(device);
    this.write(db);
    return device;
  }

  upsertSeedDevice(input: {
    productKey: string;
    productName: string;
    sn: string;
    deviceSecret: string;
  }): Device {
    const db = this.read();
    if (!db.products.some((p) => p.productKey === input.productKey)) {
      db.products.push({
        productKey: input.productKey,
        name: input.productName,
        createdAt: new Date().toISOString(),
      });
    }
    const existing = db.devices.find((d) => d.sn === input.sn);
    if (existing) {
      existing.productKey = input.productKey;
      existing.deviceSecret = input.deviceSecret;
      this.write(db);
      return existing;
    }
    const device: Device = {
      productKey: input.productKey,
      sn: input.sn,
      deviceSecret: input.deviceSecret,
      createdAt: new Date().toISOString(),
    };
    db.devices.push(device);
    this.write(db);
    return device;
  }

  appendMessage(msg: Omit<IngestMessage, "id" | "receivedAt">): IngestMessage {
    const db = this.read();
    const saved: IngestMessage = {
      ...msg,
      id: randomBytes(8).toString("hex"),
      receivedAt: new Date().toISOString(),
    };
    db.messages.unshift(saved);
    db.messages = db.messages.slice(0, MAX_MESSAGES);
    this.write(db);
    return saved;
  }

  listMessages(sn?: string): IngestMessage[] {
    const messages = this.read().messages;
    return sn ? messages.filter((m) => m.sn === sn) : messages;
  }
}

export function defaultStore(dataDir = process.env.DATA_DIR ?? join(process.cwd(), "..", "data")): FileStore {
  return new FileStore(join(dataDir, "store.json"));
}

function slugKey(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return slug || `p_${randomBytes(3).toString("hex")}`;
}
