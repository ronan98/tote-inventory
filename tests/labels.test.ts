import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { buildLabelURL } from "../src/lib/label-layout";

test("label URLs preserve explicit selections, including none, across layouts", () => {
  const selected = new URL(buildLabelURL("/api/labels/pdf", ["second", "first", "second"], "avery15264", 6), "https://inventory.example.test");
  assert.equal(selected.pathname, "/api/labels/pdf");
  assert.equal(selected.searchParams.get("ids"), "second,first");
  assert.equal(selected.searchParams.get("start"), "6");
  const empty = new URL(buildLabelURL("/labels", [], "plain", 6), selected.origin);
  assert.equal(empty.searchParams.get("ids"), "");
  assert.equal(empty.searchParams.get("format"), "plain");
  assert.equal(empty.searchParams.get("start"), "1");
});

test("print PDF preserves selected totes, skipped slots, and fixed Letter pages", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "inventory-label-test-"));
  process.env.INVENTORY_DATA_DIR = directory;
  process.env.APP_ORIGIN = "https://inventory.example.test";
  const inventory = await import("../src/lib/inventory");
  const db = await import("../src/lib/db");
  const labels = await import("../src/lib/labels");
  const route = await import("../src/app/api/labels/pdf/route");
  try {
    const first = inventory.createTote({ name: "Christmas décor" });
    const second = inventory.createTote({ name: "Camping equipment and spare charging cables " + "accessories ".repeat(5) });
    const ids = `${second.id},missing,${first.id},${second.id}`;
    const selection = labels.getLabelSelection({ ids, start: "6" });
    assert.deepEqual(labels.getLabelSelection({}).totes.map(tote => tote.id), [first.id, second.id]);
    assert.deepEqual(labels.getLabelSelection({ ids: "" }).totes, []);
    assert.deepEqual(labels.getLabelSelection({ ids: "," }).totes, []);
    assert.deepEqual(labels.getLabelOptions([selection.totes[0]]).map(tote => tote.id), [first.id, second.id]);
    assert.deepEqual(selection.totes.map(tote => tote.id), [second.id, first.id]);
    assert.deepEqual(labels.labelSheets(selection.totes, selection.start).map(sheet => sheet.map(tote => tote?.id || null)), [
      [null, null, null, null, null, second.id], [first.id, null, null, null, null, null],
    ]);
    const before = db.getDatabase().prepare("SELECT count(*) AS count FROM activities").get();
    const response = await route.GET(new Request(`${process.env.APP_ORIGIN}/api/labels/pdf?ids=${ids}&start=6`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    const pdf = await PDFDocument.load(await response.arrayBuffer());
    assert.equal(pdf.getPageCount(), 2);
    assert.deepEqual(pdf.getPages().map(page => page.getSize()), [{ width: 612, height: 792 }, { width: 612, height: 792 }]);
    assert.equal(pdf.catalog.getOrCreateViewerPreferences().getPrintScaling(), "None");
    assert.deepEqual(db.getDatabase().prepare("SELECT count(*) AS count FROM activities").get(), before);
    const plain = await route.GET(new Request(`${process.env.APP_ORIGIN}/api/labels/pdf?ids=${ids}&format=plain&start=6`));
    assert.equal((await PDFDocument.load(await plain.arrayBuffer())).getPageCount(), 1);
    const empty = await route.GET(new Request(`${process.env.APP_ORIGIN}/api/labels/pdf?ids=missing`));
    assert.equal(empty.status, 400);
    const deselected = await route.GET(new Request(`${process.env.APP_ORIGIN}/api/labels/pdf?ids=`));
    assert.equal(deselected.status, 400);
    const subset = await route.GET(new Request(`${process.env.APP_ORIGIN}${buildLabelURL("/api/labels/pdf", [second.id], "avery15264", 6)}`));
    assert.equal((await PDFDocument.load(await subset.arrayBuffer())).getPageCount(), 1);
  } finally {
    db.closeDatabase();
    await rm(directory, { recursive: true, force: true });
  }
});
