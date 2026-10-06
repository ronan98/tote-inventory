import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { copyInventorySnapshot } from "../scripts/snapshot.mjs";
import { closeDatabase, getDatabase } from "../src/lib/db";
import { createTote, deleteTote, recordPhoto } from "../src/lib/inventory";
import { randomUUID } from "node:crypto";

test("a protected snapshot retains complete photos after permanent tote deletion", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "inventory-snapshot-"));
  const live = path.join(root, "live"), copied = path.join(root, "copied"), after = path.join(root, "after");
  process.env.INVENTORY_DATA_DIR = live;
  try {
    const tote = createTote({ name: "Photo backup" }), id = randomUUID();
    await mkdir(path.join(live, "photos", id));
    for (const file of ["original", "full.jpg", "thumb.webp"]) await writeFile(path.join(live, "photos", id, file), "photo " + file);
    recordPhoto(tote.id, { id, originalName: "test.jpg", mimeType: "image/jpeg" });
    const result = await copyInventorySnapshot(live, copied);
    assert.equal(result.photos.length, 3);
    assert.equal(result.schemaVersion, 4);
    await deleteTote(tote.id);
    for (const file of ["original", "full.jpg", "thumb.webp"]) {
      assert.equal(await readFile(path.join(copied, "photos", id, file), "utf8"), "photo " + file);
    }
    const db = new Database(path.join(copied, "inventory.sqlite"), { readonly: true });
    try {
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM photos").get() as { count: number }).count, 1);
      assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
      assert.deepEqual(db.pragma("foreign_key_check"), []);
    } finally { db.close(); }
    assert.equal((await copyInventorySnapshot(live, after)).photos.length, 0);
  } finally { closeDatabase(); await rm(root, { recursive: true, force: true }); }
});

test("an incomplete photo fails the snapshot and releases the cleanup lock", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "inventory-snapshot-error-"));
  const live = path.join(root, "live"), copied = path.join(root, "copied");
  process.env.INVENTORY_DATA_DIR = live;
  try {
    const tote = createTote({ name: "Incomplete photo" }), id = randomUUID();
    await mkdir(path.join(live, "photos", id));
    await writeFile(path.join(live, "photos", id, "original"), "original");
    recordPhoto(tote.id, { id, originalName: "test.jpg", mimeType: "image/jpeg" });
    await assert.rejects(copyInventorySnapshot(live, copied), /incomplete/);
    // A leaked BEGIN IMMEDIATE would prevent this connection from editing.
    getDatabase().prepare("UPDATE totes SET notes='still editable' WHERE id=?").run(tote.id);
    await deleteTote(tote.id);
  } finally { closeDatabase(); await rm(root, { recursive: true, force: true }); }
});
