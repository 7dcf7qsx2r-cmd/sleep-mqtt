import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acceptDeviceReport, parseIngestBody } from "./ingest.js";
import { FileStore } from "./store.js";

const sample = {
  mac: "9C139EF1AE90",
  sn: "OMTY26011605",
  isbed: 1,
  heartRate: 76,
  respiratoryRate: 16,
  signal: 1,
};

test("parseIngestBody keeps the vendor payload and checks the topic", () => {
  const parsed = parseIngestBody({
    productKey: "br_mattress",
    productName: "小眠智能床垫-薄",
    sn: "omty26011605",
    topic: "/sys/br_mattress/OMTY26011605/thing/property/post",
    payload: sample,
  });
  assert.equal(parsed.sn, "OMTY26011605");
  assert.deepEqual(parsed.payload, sample);
  assert.throws(
    () => parseIngestBody({ ...parsed, topic: "/sys/cis_ip/OMTY26011605/thing/property/post", payload: sample }),
    /topic/,
  );
});

test("acceptDeviceReport registers the mattress and stores the vendor json", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sleep-mqtt-ingest-"));
  const store = new FileStore(join(dir, "store.json"));
  try {
    const report = await acceptDeviceReport(store, {
      productKey: "br_mattress",
      productName: "小眠智能床垫-薄",
      sn: "OMTY26011605",
      topic: "/sys/br_mattress/OMTY26011605/thing/property/post",
      payload: sample,
    });
    const device = await store.getDevice(report.sn);
    assert.equal(device?.productKey, "br_mattress");
    const messages = await store.listMessages(report.sn);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0]?.payload, sample);
    assert.ok(device?.lastSeenAt);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
