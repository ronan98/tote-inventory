import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import decode from "heic-decode";
import Database from "better-sqlite3";
const images = await decode.all({ buffer: await readFile(process.argv[2]) });
try {
  const image = await images[0].decode();
  const jpeg = await sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: 4 } }).jpeg().toBuffer();
  assert.ok((await sharp(jpeg).metadata()).width > 0);
  const db = new Database(":memory:");
  try { db.exec("CREATE VIRTUAL TABLE search USING fts5(name)"); assert.equal(db.pragma("integrity_check", { simple: true }), "ok"); }
  finally { db.close(); }
  console.log(JSON.stringify({ heic: "ok", width: image.width, height: image.height, sqliteFTS5: "ok" }));
} finally { images.dispose(); }
