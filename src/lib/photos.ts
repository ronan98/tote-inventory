import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDatabase } from "./db";
import { aiEnabled, createAIRun } from "./ai";
import sharp from "sharp";
import heicDecode from "heic-decode";
import { DomainError, getPhoto, getTote, recordPhoto, removeUnreferencedPhotoFiles } from "./inventory";
import { limitedBody, requireSameOrigin } from "./http";

export function dataDirectory() { return path.resolve(/* turbopackIgnore: true */ process.env.INVENTORY_DATA_DIR || path.join(process.cwd(), "data")); }
export function photosDirectory() { return path.join(dataDirectory(), "photos"); }
let processing = false;
function detectType(bytes: Buffer): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.toString("ascii", 4, 8) === "ftyp") {
    const brands = bytes.toString("ascii", 8, Math.min(bytes.length, 64));
    if (/avif|avis/.test(brands)) return "image/avif";
    if (/heic|heix|hevc|hevx|mif1|msf1/.test(brands)) return "image/heic";
  }
  return null;
}
export async function uploadPhoto(toteId: string, request: Request) {
  requireSameOrigin(request);
  const tote = getTote(toteId);
  if (tote.tote.archivedAt) throw new DomainError(409, "Restore the tote before changing its photo.");
  if (processing) throw new DomainError(429, "Another photo is being processed. Try again in a moment.");
  processing = true;
  let stagedPath: string | undefined;
  let publishedId: string | undefined;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("multipart/form-data")) throw new DomainError(415, "Choose a photo to upload.");
    const bytes = await limitedBody(request, 26 * 1024 * 1024);
    const form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": contentType } }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new DomainError(400, "Choose a photo to upload.");
    if (file.size > 25 * 1024 * 1024) throw new DomainError(413, "Choose a photo smaller than 25 MB.");
    const original = Buffer.from(await file.arrayBuffer());
    const mimeType = detectType(original);
    if (!mimeType) throw new DomainError(415, "Use a JPEG, PNG, WebP, AVIF, or HEIC photo.");
    let image;
    if (mimeType === "image/heic") {
      let images: Awaited<ReturnType<typeof heicDecode.all>> | undefined;
      try {
        images = await heicDecode.all({ buffer: original });
        const first = images[0];
        if (!first || first.width * first.height > 60_000_000) throw new DomainError(422, "Choose a photo smaller than 60 megapixels.");
        const decoded = await first.decode();
        image = sharp(Buffer.from(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength), { raw: { width: decoded.width, height: decoded.height, channels: 4 } });
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError(422, "This iPhone photo could not be read. Try a different photo or a JPEG copy.");
      } finally { images?.dispose(); }
    } else { image = sharp(original, { limitInputPixels: 60_000_000, failOn: "error" }).rotate(); }
    let full: Buffer;
    let thumb: Buffer;
    try {
      const metadata = await image.metadata();
      if (!metadata.width || !metadata.height) throw new Error("Missing dimensions");
      full = await image.clone().resize({ width: 3072, height: 3072, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
      thumb = await image.clone().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch { throw new DomainError(422, "This image could not be read. Try another photo."); }
    const id = randomUUID();
    const parent = photosDirectory();
    await mkdir(parent, { recursive: true, mode: 0o700 });
    stagedPath = path.join(parent, ".upload-" + id);
    await mkdir(stagedPath, { mode: 0o700 });
    await Promise.all([
      writeFile(path.join(stagedPath, "original"), original, { mode: 0o600 }),
      writeFile(path.join(stagedPath, "full.jpg"), full, { mode: 0o600 }),
      writeFile(path.join(stagedPath, "thumb.webp"), thumb, { mode: 0o600 }),
    ]);
    await rename(stagedPath, path.join(parent, id));
    stagedPath = undefined;
    publishedId = id;
    const originalName = (file.name.split(/[\\/]/).pop() || "photo").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200);
    const detail = getDatabase().transaction(() => {
      const detail = recordPhoto(toteId, { id, originalName, mimeType });
      if (aiEnabled()) createAIRun(toteId, { photoId: id, contentsUpdatedAt: detail.tote.contentsUpdatedAt });
      return detail;
    }).immediate();
    publishedId = undefined;
    return detail;
  } finally {
    processing = false;
    if (stagedPath) await rm(stagedPath, { force: true, recursive: true });
    // A tote may have been deleted while bytes were decoded or written. The
    // metadata transaction rechecks it; a failed commit must not leave files.
    if (publishedId) removeUnreferencedPhotoFiles([publishedId]);
  }
}
export async function servePhoto(id: string, variant: string | null) {
  const photo = getPhoto(id);
  const size = variant || "full";
  if (!["full", "thumb", "original"].includes(size)) throw new DomainError(400, "Unknown photo size.");
  const file = size === "full" ? "full.jpg" : size === "thumb" ? "thumb.webp" : "original";
  let bytes: Buffer;
  try { bytes = await readFile(path.join(photosDirectory(), photo.id, file)); }
  catch { throw new DomainError(404, "This photo file is unavailable."); }
  const headers: Record<string,string> = {
    "Content-Type": size === "full" ? "image/jpeg" : size === "thumb" ? "image/webp" : photo.mimeType,
    "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"
  };
  if (size === "original") headers["Content-Disposition"] = "attachment; filename*=UTF-8''" + encodeURIComponent(photo.originalName);
  return new Response(new Uint8Array(bytes), { headers });
}
