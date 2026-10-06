import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { closeDatabase, getDatabase } from "../src/lib/db";
import { exportInventory } from "../src/lib/export";
import { createTote, recordPhoto } from "../src/lib/inventory";

// Read actual ZIP entries using the central directory, rather than treating
// a filename appearing somewhere in the binary archive as proof it exists.
// Exports use the ZIP store method, so fixture bytes need no decompressor.
function zipEntries(bytes: Buffer): Map<string, Buffer> {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  assert.equal(bytes.readUInt16LE(end + 20), 0);
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    assert.equal(bytes.readUInt16LE(offset + 10), 0, "Backup entries must use the store method.");
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    assert.ok(start + size <= offset, "Entry contents must precede the central directory.");
    assert.equal(entries.has(name), false, "Duplicate ZIP entry: " + name);
    entries.set(name, bytes.subarray(start, start + size));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test("an empty inventory ZIP includes a restorable database and photos directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "inventory-empty-export-"));
  const previous = process.env.INVENTORY_DATA_DIR;
  process.env.INVENTORY_DATA_DIR = path.join(root, "live");
  try {
    const response = await exportInventory(null);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/zip");
    const entries = zipEntries(Buffer.from(await response.arrayBuffer()));
    assert.deepEqual([...entries.keys()].sort(), ["README.txt", "inventory.sqlite", "manifest.json", "photos/"]);
    assert.equal(entries.get("photos/")!.length, 0);
    const manifest = JSON.parse(entries.get("manifest.json")!.toString());
    assert.equal(manifest.format, "home-inventory-backup");
    assert.equal(manifest.schemaVersion, 4);
    const databasePath = path.join(root, "snapshot.sqlite");
    await writeFile(databasePath, entries.get("inventory.sqlite")!);
    const snapshot = new Database(databasePath, { readonly: true });
    try {
      assert.equal(snapshot.pragma("integrity_check", { simple: true }), "ok");
      assert.equal((snapshot.prepare("SELECT COUNT(*) AS count FROM totes").get() as { count: number }).count, 0);
      assert.equal((snapshot.prepare("SELECT COUNT(*) AS count FROM photos").get() as { count: number }).count, 0);
    } finally { snapshot.close(); }
  } finally {
    closeDatabase();
    if (previous === undefined) delete process.env.INVENTORY_DATA_DIR;
    else process.env.INVENTORY_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a populated inventory ZIP retains photo bytes and their matching database record", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "inventory-photo-export-"));
  const previous = process.env.INVENTORY_DATA_DIR;
  process.env.INVENTORY_DATA_DIR = path.join(root, "live");
  try {
    const tote = createTote({ name: "Backup fixture" });
    const id = randomUUID();
    const files = { original: Buffer.from("original fixture bytes"), "full.jpg": Buffer.from("full fixture bytes"), "thumb.webp": Buffer.from("thumbnail fixture bytes") };
    const directory = path.join(process.env.INVENTORY_DATA_DIR, "photos", id);
    await mkdir(directory);
    for (const [name, bytes] of Object.entries(files)) await writeFile(path.join(directory, name), bytes);
    recordPhoto(tote.id, { id, originalName: "contents.jpg", mimeType: "image/jpeg" });
    const response = await exportInventory(null);
    assert.equal(response.status, 200);
    const entries = zipEntries(Buffer.from(await response.arrayBuffer()));
    assert.ok(entries.has("photos/"));
    for (const [name, bytes] of Object.entries(files)) assert.deepEqual(entries.get(`photos/${id}/${name}`), bytes);
    const databasePath = path.join(root, "snapshot.sqlite");
    await writeFile(databasePath, entries.get("inventory.sqlite")!);
    const snapshot = new Database(databasePath, { readonly: true });
    try {
      assert.deepEqual(snapshot.prepare("SELECT id, tote_id, original_name FROM photos").all(), [{ id, tote_id: tote.id, original_name: "contents.jpg" }]);
      assert.equal(snapshot.pragma("integrity_check", { simple: true }), "ok");
      assert.deepEqual(snapshot.pragma("foreign_key_check"), []);
    } finally { snapshot.close(); }
    assert.equal((getDatabase().prepare("SELECT COUNT(*) AS count FROM photos").get() as { count: number }).count, 1);
  } finally {
    closeDatabase();
    if (previous === undefined) delete process.env.INVENTORY_DATA_DIR;
    else process.env.INVENTORY_DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
