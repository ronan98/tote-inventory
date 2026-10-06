import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { ZipArchive } from "archiver";
import { getDatabase, getExportSnapshot } from "./inventory";
import { getDataDirectory } from "./db";
import { copyInventorySnapshot } from "../../scripts/snapshot.mjs";
let exporting = false;
export async function exportInventory(format: string | null) {
  if (format === "json") return Response.json(getExportSnapshot(), { headers: { "Content-Disposition": 'attachment; filename="inventory.json"', "Cache-Control": "no-store" } });
  if (exporting) return Response.json({ error: "Another backup is being prepared. Try again in a moment." }, { status: 429 });
  exporting = true;
  let temp: string | undefined;
  try {
    temp = await mkdtemp(path.join(tmpdir(), "inventory-export-"));
    const snapshot = path.join(temp, "inventory.sqlite");
    getDatabase();
    const result = await copyInventorySnapshot(getDataDirectory(), temp);
    const archive = new ZipArchive({ store: true });
    const output = new PassThrough();
    archive.on("error", (error: Error) => output.destroy(error));
    archive.on("warning", (error: Error) => output.destroy(error));
    output.on("close", () => { exporting = false; void rm(temp!, { force: true, recursive: true }); });
    archive.pipe(output);
    archive.file(snapshot, { name: "inventory.sqlite" });
    // Archiver does not emit the root of an empty directory. Keep every backup
    // self-contained, including inventories with no uploaded photos yet.
    archive.append(Buffer.alloc(0), { name: "photos/", type: "directory" });
    archive.directory(path.join(temp, "photos"), "photos");
    archive.append(JSON.stringify({ format: "home-inventory-backup", version: 1, schemaVersion: result.schemaVersion, exportedAt: new Date().toISOString() }, null, 2), { name: "manifest.json" });
    archive.append("Home Inventory backup\n\nContains an online SQLite snapshot and all retained photos, including originals.\nRestore only into an empty data directory while the app is stopped.\nSee docs/BACKUP-RESTORE.md in the project for restore instructions.\n", { name: "README.txt" });
    void archive.finalize().catch((error: Error) => output.destroy(error));
    const body = Readable.toWeb(output) as ReadableStream<Uint8Array>;
    return new Response(body, { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="home-inventory-' + new Date().toISOString().slice(0,10) + '.zip"', "Cache-Control": "no-store" } });
  } catch (error) { exporting = false; if (temp) await rm(temp, { force: true, recursive: true }); throw error; }
}
