import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

test("HTTP inventory workflow, upload validation, and downloadable backup", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "inventory-api-test-"));
  process.env.INVENTORY_DATA_DIR = directory;
  process.env.APP_ORIGIN = "https://inventory.home.arpa";
  const totes = await import("../src/app/api/totes/route");
  const detail = await import("../src/app/api/totes/[id]/route");
  const items = await import("../src/app/api/totes/[id]/items/route");
  const take = await import("../src/app/api/items/[id]/take/route");
  const returns = await import("../src/app/api/removals/[id]/return/route");
  const photos = await import("../src/app/api/totes/[id]/photos/route");
  const photo = await import("../src/app/api/photos/[id]/route");
  const qr = await import("../src/app/api/totes/[id]/qr.svg/route");
  const search = await import("../src/app/api/search/route");
  const exporting = await import("../src/app/api/export/route");
  const domain = await import("../src/lib/inventory");
  const context = (id: string) => ({ params: Promise.resolve({ id }) });
  const request = (url: string, method = "GET", body?: unknown, origin = process.env.APP_ORIGIN!) =>
    new Request(process.env.APP_ORIGIN + url, { method, headers: { Origin: origin, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let id = "";
  try {
    await t.test("more than ten totes and cross-origin protection", async () => {
      const rejected = await totes.POST(request("/api/totes", "POST", { name: "Rejected" }, "https://other.example"));
      assert.equal(rejected.status, 403);
      for (let i = 0; i < 12; i++) {
        const response = await totes.POST(request("/api/totes", "POST", { name: "API test tote " + (i + 1) }));
        assert.equal(response.status, 201);
        const result = await response.json();
        if (!id) id = result.tote.id;
      }
      const response = await totes.GET(request("/api/totes"));
      assert.equal((await response.json()).totes.length, 12);
    });
    await t.test("take out and return preserve the original tote", async () => {
      let response = await items.POST(request("/api/totes/" + id + "/items", "POST", { items: [{ name: "Extension cord", quantity: 4 }] }), context(id));
      assert.equal(response.status, 201);
      let result = await response.json();
      const itemId = result.items[0].id;
      response = await take.POST(request("/api/items/" + itemId + "/take", "POST", { toteId: id, quantity: 3 }), context(itemId));
      assert.equal(response.status, 200);
      result = await response.json();
      assert.equal(result.items[0].quantity, 1);
      assert.equal(result.removals[0].outstandingQuantity, 3);
      const removalId = result.removals[0].id;
      response = await returns.POST(request("/api/removals/" + removalId + "/return", "POST", { quantity: 1 }), context(removalId));
      assert.equal(response.status, 200);
      result = await response.json();
      assert.equal(result.items[0].quantity, 2);
      assert.equal(result.removals[0].outstandingQuantity, 2);
      const found = await search.GET(request("/api/search?q=extension"));
      const matches = (await found.json()).results;
      assert.equal(matches[0].toteId, id);
      assert.equal(matches[0].outstandingQuantity, 2);
      const invalid = await take.POST(request("/api/items/" + itemId + "/take", "POST", { toteId: id, quantity: 99 }), context(itemId));
      assert.equal(invalid.status, 409);
      const archived = await detail.DELETE(request("/api/totes/" + id, "DELETE"), context(id));
      assert.equal(archived.status, 409);
    });
    await t.test("QR target survives tote renaming", async () => {
      const before = await qr.GET(request("/api/totes/" + id + "/qr.svg"), context(id));
      const svg = await before.text();
      assert.equal(before.status, 200);
      assert.match(svg, /<svg/);
      assert.equal((await detail.PATCH(request("/api/totes/" + id, "PATCH", { name: "Renamed tote" }), context(id))).status, 200);
      assert.equal(await (await qr.GET(request("/api/totes/" + id + "/qr.svg"), context(id))).text(), svg);
    });
    const upload = async (bytes: Buffer, name: string) => {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(bytes)], name));
      return photos.POST(new Request(process.env.APP_ORIGIN + "/api/totes/" + id + "/photos", { method: "POST", headers: { Origin: process.env.APP_ORIGIN! }, body: form }), context(id));
    };
    await t.test("real PNG and AVIF bytes become display photos, invalid files do not", async () => {
      assert.equal((await upload(Buffer.from("not an image"), "pretend.jpg")).status, 415);
      const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: "#28634c" } }).png().toBuffer();
      let response = await upload(png, "test.png");
      assert.equal(response.status, 200);
      let result = await response.json();
      const oldId = result.tote.photo.id;
      const displayed = await photo.GET(request("/api/photos/" + oldId), context(oldId));
      assert.equal(displayed.headers.get("Content-Type"), "image/jpeg");
      assert.equal((await sharp(Buffer.from(await displayed.arrayBuffer())).metadata()).width, 120);
      const avif = await sharp(png).avif().toBuffer();
      response = await upload(avif, "test.avif");
      assert.equal(response.status, 200);
      result = await response.json();
      assert.notEqual(result.tote.photo.id, oldId);
      assert.equal((await photo.GET(request("/api/photos/" + oldId + "?size=original"), context(oldId))).status, 200);
    });
    await t.test("HEIC is decoded through the iPhone photo path", { skip: !process.env.HEIC_TEST_FILE }, async () => {
      const response = await upload(await readFile(process.env.HEIC_TEST_FILE!), "example.heic");
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
      const result = await response.json();
      const displayed = await photo.GET(request("/api/photos/" + result.tote.photo.id), context(result.tote.photo.id));
      assert.equal(displayed.status, 200);
      const metadata = await sharp(Buffer.from(await displayed.arrayBuffer())).metadata();
      assert.ok(metadata.width! > 0 && metadata.width! <= 3072);
    });
    await t.test("downloaded ZIP contains a database and retained original photos", async () => {
      const response = await exporting.GET(request("/api/export"));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Content-Type"), "application/zip");
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.readUInt32LE(0), 0x04034b50);
      assert.ok(bytes.includes(Buffer.from("inventory.sqlite")));
      assert.ok(bytes.includes(Buffer.from("/original")));
      if (process.env.EXPORT_TEST_FILE) await writeFile(process.env.EXPORT_TEST_FILE, bytes);
      const json = await exporting.GET(request("/api/export?format=json"));
      assert.equal(json.status, 200);
      assert.ok(await json.json());
    });
  } finally {
    domain.getDatabase().close();
    await rm(directory, { recursive: true, force: true });
  }
});
