import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabase } from "../src/lib/db";
import { addItems, archiveTote, createTote, DomainError, getDatabase, getExportSnapshot, getPhoto, getTote, listActivity, listTotes, moveItem, recordPhoto, restoreTote, returnItem, searchInventory, takeItem, updateItem, updateTote } from "../src/lib/inventory";

test("real SQLite inventory preserves quantities, original locations, and history", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "inventory-domain-"));
  const previousDirectory = process.env.INVENTORY_DATA_DIR;
  process.env.INVENTORY_DATA_DIR = directory;
  const conflict = (run: () => unknown) => assert.throws(run, error => error instanceof DomainError && error.status === 409);
  try {
    const source = createTote({ name: "Tools", notes: "Garage shelf" });
    const destination = createTote({ name: "Cables" });
    const third = createTote({ name: "Workshop" });
    let detail = addItems(source.id, { items: [{ name: "Extension cord", notes: "Orange six metre cable", quantity: 6 }] });
    const itemId = detail.items[0].id;
    await t.test("partial take, return, and move conserve stock and original location", () => {
      detail = takeItem(itemId, { toteId: source.id, quantity: 2 });
      assert.equal(detail.items[0].quantity, 4);
      const removalId = detail.removals[0].id;
      assert.equal(detail.removals[0].toteId, source.id);
      detail = returnItem(removalId, { quantity: 1 });
      assert.equal(detail.items[0].quantity, 5);
      assert.equal(detail.removals[0].outstandingQuantity, 1);
      detail = moveItem(itemId, { sourceToteId: source.id, destinationToteId: destination.id, quantity: 2 });
      assert.equal(detail.items[0].quantity, 3);
      assert.equal(getTote(destination.id).items[0].quantity, 2);
      detail = returnItem(removalId, { quantity: 1, destinationToteId: third.id });
      assert.equal(detail.removals.length, 0);
      assert.equal(getTote(third.id).items[0].quantity, 1);
      assert.equal(listTotes().reduce((sum, tote) => sum + tote.totalQuantity, 0), 6);
      conflict(() => returnItem(removalId, { quantity: 1 }));
      assert.ok(getTote(destination.id).history.some(entry => entry.description.includes("Moved 2 Extension cord")));
    });
    await t.test("invalid counts and rejected transactions do not change quantity or history", () => {
      const before = getTote(source.id);
      for (const quantity of [0, -1, 1.5, 100001]) assert.throws(() => takeItem(itemId, { toteId: source.id, quantity }));
      conflict(() => takeItem(itemId, { toteId: source.id, quantity: 99 }));
      conflict(() => moveItem(itemId, { sourceToteId: source.id, destinationToteId: destination.id, quantity: 99 }));
      assert.deepEqual(getTote(source.id), before);
      updateItem(itemId, { toteId: destination.id, quantity: 100000 });
      const cappedBefore = getTote(source.id);
      conflict(() => moveItem(itemId, { sourceToteId: source.id, destinationToteId: destination.id, quantity: 1 }));
      assert.deepEqual(getTote(source.id), cappedBefore);
      assert.equal(getTote(destination.id).items[0].quantity, 100000);
      updateItem(itemId, { toteId: destination.id, quantity: 2 });
    });
    await t.test("FTS prefix search follows rename and locates every placement", () => {
      assert.equal(searchInventory("oran").results.length, 3);
      assert.equal(searchInventory(source.code).results[0].toteId, source.id);
      assert.equal(searchInventory("").results.length, 3);
      assert.doesNotThrow(() => searchInventory('" OR * ( extension'));
      updateItem(itemId, { toteId: source.id, name: "Heavy-duty cable" });
      assert.equal(searchInventory("heavy").results.length, 3);
      assert.equal(searchInventory("extension").results.length, 0);
      assert.equal(getTote(destination.id).items[0].name, "Heavy-duty cable");
      assert.ok(getTote(source.id).history.some(entry => entry.description.includes("Extension cord")));
    });
    await t.test("out-only items remain findable and block archive until relocated", () => {
      const tote = createTote({ name: "Spare hardware" });
      const added = addItems(tote.id, { items: [{ name: "Door hinge", quantity: 1 }] });
      const taken = takeItem(added.items[0].id, { toteId: tote.id, quantity: 1 });
      assert.equal(taken.items[0].quantity, 0);
      assert.equal(searchInventory("hinge").results[0].outstandingQuantity, 1);
      assert.equal(searchInventory("hinge").results[0].quantity, 0);
      conflict(() => archiveTote(tote.id));
      returnItem(taken.removals[0].id, { quantity: 1, destinationToteId: third.id });
      const archived = archiveTote(tote.id);
      assert.ok(archived.tote.archivedAt);
      assert.equal(listTotes().some(row => row.id === tote.id), false);
      assert.equal(listTotes({ includeArchived: true }).some(row => row.id === tote.id), true);
      assert.equal(restoreTote(tote.id).tote.archivedAt, null);
    });
    await t.test("photo replacement retains old metadata, and edits mark the photo stale", async () => {
      const first = randomUUID(), second = randomUUID();
      recordPhoto(source.id, { id: first, originalName: "top-down.heic", mimeType: "image/heic" });
      detail = recordPhoto(source.id, { id: second, originalName: "updated.jpg", mimeType: "image/jpeg" });
      assert.equal(detail.tote.photo?.id, second);
      assert.equal(getPhoto(first).originalName, "top-down.heic");
      assert.ok(detail.tote.photo!.createdAt >= detail.tote.contentsUpdatedAt);
      updateItem(itemId, { toteId: source.id, quantity: 2 });
      detail = getTote(source.id);
      assert.ok(detail.tote.contentsUpdatedAt > detail.tote.photo!.createdAt);
      assert.ok((await stat(path.join(directory, "photos"))).isDirectory());
      assert.equal(getExportSnapshot().photos.length, 2);
    });
    await t.test("archive and restore keep QR identity, history, and monotonic tote codes", () => {
      conflict(() => archiveTote(source.id));
      updateItem(itemId, { toteId: source.id, quantity: 0 });
      const archived = archiveTote(source.id);
      assert.equal(archived.tote.id, source.id);
      assert.ok(archived.history.some(entry => entry.type === "tote_archived"));
      conflict(() => updateTote(source.id, { name: "Unavailable" }));
      restoreTote(source.id);
      assert.equal(updateTote(source.id, { name: "Renamed tools" }).code, source.code);
      closeDatabase();
      assert.equal(getTote(source.id).tote.name, "Renamed tools");
      const next = createTote({ name: "Next tote" });
      assert.equal(next.code, "T005");
      assert.equal(getDatabase().pragma("user_version", { simple: true }), 4);
      assert.equal(getDatabase().pragma("foreign_keys", { simple: true }), 1);
      assert.equal(getDatabase().pragma("journal_mode", { simple: true }), "wal");
      assert.ok(listActivity().every(entry => /T\d+/.test(entry.description)));
    });
  } finally {
    closeDatabase();
    if (previousDirectory === undefined) delete process.env.INVENTORY_DATA_DIR;
    else process.env.INVENTORY_DATA_DIR = previousDirectory;
    await rm(directory, { recursive: true, force: true });
  }
});
