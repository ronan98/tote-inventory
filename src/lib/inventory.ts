import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getDatabase, getDataDirectory, getDrizzleDatabase } from "./db";
import { totes, items } from "./schema";
import { toteInput, itemBatchInput, itemEditInput, takeInput, moveInput, returnInput } from "./validation";
import type { ActivityDTO, PhotoDTO, PhotoRecordDTO, RemovalDTO, SearchDTO, SearchResultDTO, ToteDetailDTO, ToteDTO } from "./contracts";
export { getDatabase } from "./db";

export class DomainError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "DomainError"; }
}
type ToteRow = { id: string; code: string; name: string; notes: string; currentPhotoId: string | null; archivedAt: string | null; createdAt: string; updatedAt: string; contentsUpdatedAt: string };
type ItemRow = { id: string; name: string; notes: string; archivedAt: string | null; createdAt: string; updatedAt: string };
type RemovalRow = { id: string; itemId: string; originalToteId: string | null; originalToteCode: string | null; originalToteName: string | null; quantity: number; outstandingQuantity: number; createdAt: string; updatedAt: string };
const toteColumns = "id,code,name,notes,current_photo_id AS currentPhotoId,archived_at AS archivedAt,created_at AS createdAt,updated_at AS updatedAt,contents_updated_at AS contentsUpdatedAt";
const itemColumns = "id,name,notes,archived_at AS archivedAt,created_at AS createdAt,updated_at AS updatedAt";
function now(): string { return new Date().toISOString(); }
function requireTote(id: string, active = false): ToteRow {
  const row = getDatabase().prepare(`SELECT ${toteColumns} FROM totes WHERE id=?`).get(id) as ToteRow | undefined;
  if (!row) throw new DomainError(404, "This tote could not be found.");
  if (active && row.archivedAt) throw new DomainError(409, "Restore this tote before changing its inventory.");
  return row;
}
function requireItem(id: string): ItemRow {
  const row = getDatabase().prepare(`SELECT ${itemColumns} FROM items WHERE id=? AND archived_at IS NULL`).get(id) as ItemRow | undefined;
  if (!row) throw new DomainError(404, "This item could not be found.");
  return row;
}
function requirePlacement(itemId: string, toteId: string): number {
  const row = getDatabase().prepare("SELECT stored_quantity AS quantity FROM tote_contents WHERE item_id=? AND tote_id=?").get(itemId, toteId) as { quantity: number } | undefined;
  if (!row) throw new DomainError(404, "This item is not associated with this tote.");
  return row.quantity;
}
function touchContents(toteId: string): void {
  const current = requireTote(toteId);
  const timestamp = new Date(Math.max(Date.now(), Date.parse(current.contentsUpdatedAt) + 1, Date.parse(current.currentPhotoId ? getPhoto(current.currentPhotoId).createdAt : current.contentsUpdatedAt) + 1)).toISOString();
  getDatabase().prepare("UPDATE totes SET updated_at=?,contents_updated_at=? WHERE id=?").run(timestamp, timestamp, toteId);
}
function addStock(toteId: string, itemId: string, quantity: number): void {
  const row = getDatabase().prepare("SELECT stored_quantity AS quantity FROM tote_contents WHERE tote_id=? AND item_id=?").get(toteId, itemId) as { quantity: number } | undefined;
  if ((row?.quantity || 0) + quantity > 100000) throw new DomainError(409, "A single item count cannot exceed 100,000.");
  getDatabase().prepare("INSERT INTO tote_contents(tote_id,item_id,stored_quantity) VALUES(?,?,?) ON CONFLICT(tote_id,item_id) DO UPDATE SET stored_quantity=stored_quantity+excluded.stored_quantity").run(toteId, itemId, quantity);
}
function logActivity(type: string, toteId: string | null, description: string, item?: ItemRow, quantity?: number, otherToteId?: string): void {
  getDatabase().prepare("INSERT INTO activities(id,type,tote_id,other_tote_id,item_id,item_name,quantity,details,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(), type, toteId, otherToteId || null, item?.id || null, item?.name || null, quantity ?? null, JSON.stringify({ description }), now());
}
function toteLabel(tote: ToteRow): string { return `${tote.code} (${tote.name})`; }
function photoDTO(id: string | null): PhotoDTO | null {
  if (!id) return null;
  const photo = getPhoto(id);
  return { id, url: `/api/photos/${id}?size=full`, thumbUrl: `/api/photos/${id}?size=thumb`, createdAt: photo.createdAt };
}
function toteDTO(row: ToteRow): ToteDTO {
  const counts = getDatabase().prepare("SELECT COUNT(CASE WHEN stored_quantity>0 THEN 1 END) AS itemCount,COALESCE(SUM(stored_quantity),0) AS totalQuantity FROM tote_contents WHERE tote_id=?").get(row.id) as { itemCount: number; totalQuantity: number };
  const outstanding = getDatabase().prepare("SELECT COALESCE(SUM(outstanding_quantity),0) AS quantity FROM removals WHERE original_tote_id=?").get(row.id) as { quantity: number };
  return { id: row.id, code: row.code, name: row.name, notes: row.notes, photo: photoDTO(row.currentPhotoId), ...counts, outstandingQuantity: outstanding.quantity, createdAt: row.createdAt, updatedAt: row.updatedAt, contentsUpdatedAt: row.contentsUpdatedAt, archivedAt: row.archivedAt };
}
function activityDTOs(sql: string, ...parameters: string[]): ActivityDTO[] {
  return (getDatabase().prepare(sql).all(...parameters) as { id: string; type: string; details: string; createdAt: string }[]).map(row => ({ id: row.id, type: row.type, description: String(JSON.parse(row.details).description || row.type), createdAt: row.createdAt }));
}
function removalDTOs(toteId?: string): RemovalDTO[] {
  return getDatabase().prepare(`SELECT r.id,r.item_id AS itemId,i.name AS itemName,i.notes AS itemNotes,r.original_tote_id AS toteId,COALESCE(t.code,r.original_tote_code) AS toteCode,COALESCE(t.name,r.original_tote_name) AS toteName,r.quantity,r.outstanding_quantity AS outstandingQuantity,r.created_at AS createdAt FROM removals r JOIN items i ON i.id=r.item_id LEFT JOIN totes t ON t.id=r.original_tote_id WHERE r.outstanding_quantity>0 AND i.archived_at IS NULL${toteId ? " AND r.original_tote_id=?" : ""} ORDER BY r.created_at DESC,r.rowid DESC`).all(...(toteId ? [toteId] : [])) as RemovalDTO[];
}
export function listRemovals(): RemovalDTO[] { return removalDTOs(); }
export function listTotes(options: { includeArchived?: boolean } = {}): ToteDTO[] {
  const rows = getDatabase().prepare(`SELECT ${toteColumns} FROM totes ${options.includeArchived ? "" : "WHERE archived_at IS NULL"} ORDER BY CAST(SUBSTR(code,2) AS INTEGER)`).all() as ToteRow[];
  return rows.map(toteDTO);
}
export function getTote(id: string): ToteDetailDTO {
  const tote = requireTote(id), db = getDatabase();
  const itemRows = db.prepare("SELECT i.id,i.name,i.notes,c.stored_quantity AS quantity,i.updated_at AS updatedAt FROM tote_contents c JOIN items i ON i.id=c.item_id WHERE c.tote_id=? AND i.archived_at IS NULL AND (c.stored_quantity>0 OR EXISTS(SELECT 1 FROM removals r WHERE r.item_id=c.item_id AND r.original_tote_id=c.tote_id AND r.outstanding_quantity>0)) ORDER BY i.name COLLATE NOCASE,i.id").all(id) as ToteDetailDTO["items"];
  const removalRows = removalDTOs(id);
  const history = activityDTOs("SELECT id,type,details,created_at AS createdAt FROM activities WHERE tote_id=? OR other_tote_id=? ORDER BY created_at DESC,rowid DESC LIMIT 200", id, id);
  return { tote: toteDTO(tote), items: itemRows, removals: removalRows, history };
}
export function listActivity(): ActivityDTO[] { return activityDTOs("SELECT id,type,details,created_at AS createdAt FROM activities ORDER BY created_at DESC,rowid DESC LIMIT 100"); }
export function createTote(input: unknown): ToteDTO {
  const data = toteInput.parse(input), id = randomUUID(), timestamp = now();
  getDatabase().transaction(() => {
    const sequence = getDatabase().prepare("SELECT value FROM settings WHERE key='next_tote_number'").get() as { value: number };
    const code = `T${String(sequence.value).padStart(3, "0")}`;
    getDrizzleDatabase().insert(totes).values({ id, code, name: data.name, notes: data.notes || "", createdAt: timestamp, updatedAt: timestamp, contentsUpdatedAt: timestamp }).run();
    getDatabase().prepare("UPDATE settings SET value=value+1 WHERE key='next_tote_number'").run();
    logActivity("tote_created", id, `Created ${code} (${data.name}).`);
  }).immediate();
  return toteDTO(requireTote(id));
}
export function updateTote(id: string, input: unknown): ToteDTO {
  const data = toteInput.parse(input);
  getDatabase().transaction(() => {
    const tote = requireTote(id, true);
    getDatabase().prepare("UPDATE totes SET name=?,notes=?,updated_at=? WHERE id=?").run(data.name, data.notes ?? tote.notes, now(), id);
    logActivity("tote_updated", id, `Updated ${tote.code} (${data.name}).`);
  }).immediate();
  return toteDTO(requireTote(id));
}
export function archiveTote(id: string): ToteDetailDTO {
  getDatabase().transaction(() => {
    const tote = requireTote(id, true), summary = toteDTO(tote);
    if (summary.totalQuantity > 0 || summary.outstandingQuantity > 0) throw new DomainError(409, "Empty this tote and return or relocate its taken-out items before archiving it.");
    getDatabase().prepare("UPDATE totes SET archived_at=?,updated_at=? WHERE id=?").run(now(), now(), id);
    logActivity("tote_archived", id, `Archived ${toteLabel(tote)}.`);
  }).immediate();
  return getTote(id);
}
export function restoreTote(id: string): ToteDetailDTO {
  getDatabase().transaction(() => {
    const tote = requireTote(id);
    if (!tote.archivedAt) throw new DomainError(409, "This tote is already active.");
    getDatabase().prepare("UPDATE totes SET archived_at=NULL,updated_at=? WHERE id=?").run(now(), id);
    logActivity("tote_restored", id, `Restored ${toteLabel(tote)}.`);
  }).immediate();
  return getTote(id);
}
/** Call only after committing metadata removal. The write lock also protects backup photo copies. */
export function removeUnreferencedPhotoFiles(photoIds: string[]): void {
  getDatabase().transaction(() => {
    const parent = path.join(getDataDirectory(), "photos");
    if (lstatSync(parent).isSymbolicLink()) throw new Error("The photo directory must not be a symbolic link.");
    const resolvedParent = realpathSync(parent);
    for (const id of photoIds) {
      if (!z.string().uuid().safeParse(id).success) throw new Error("Refusing to remove an invalid photo directory.");
      const target = path.resolve(resolvedParent, id);
      if (path.dirname(target) !== resolvedParent) throw new Error("Refusing to remove a directory outside photo storage.");
      if (!getDatabase().prepare("SELECT id FROM photos WHERE id=?").get(id)) rmSync(target, { recursive: true, force: true });
    }
  }).immediate();
}
export function deleteTote(id: string): { deleted: true } {
  const photoIds = getDatabase().transaction(() => {
    const db = getDatabase(), tote = requireTote(id), timestamp = now();
    const photoRows = db.prepare("SELECT id FROM photos WHERE tote_id=?").all(id) as { id: string }[];
    // Contents remain tracked outside storage, even when their original tote no longer exists.
    const contents = db.prepare("SELECT item_id AS itemId,stored_quantity AS quantity FROM tote_contents WHERE tote_id=? AND stored_quantity>0").all(id) as { itemId: string; quantity: number }[];
    for (const content of contents) {
      db.prepare("INSERT INTO removals(id,item_id,original_tote_id,original_tote_code,original_tote_name,quantity,outstanding_quantity,created_at,updated_at) VALUES(?,?,NULL,?,?,?,?,?,?)").run(randomUUID(), content.itemId, tote.code, tote.name, content.quantity, content.quantity, timestamp, timestamp);
    }
    db.prepare("UPDATE removals SET original_tote_id=NULL,original_tote_code=?,original_tote_name=?,updated_at=? WHERE original_tote_id=?").run(tote.code, tote.name, timestamp, id);
    db.prepare("UPDATE activities SET tote_id=NULL WHERE tote_id=?").run(id);
    db.prepare("UPDATE activities SET other_tote_id=NULL WHERE other_tote_id=?").run(id);
    db.prepare("DELETE FROM ai_suggestion_runs WHERE tote_id=?").run(id);
    // Break the tote → photo → tote reference cycle before removing either record.
    db.prepare("UPDATE totes SET current_photo_id=NULL WHERE id=?").run(id);
    db.prepare("DELETE FROM photos WHERE tote_id=?").run(id);
    db.prepare("DELETE FROM tote_contents WHERE tote_id=?").run(id);
    db.prepare("DELETE FROM totes WHERE id=?").run(id);
    logActivity("tote_deleted", null, `Deleted ${toteLabel(tote)}. Its tracked contents are now taken out with no tote assigned.`);
    return photoRows.map(photo => photo.id);
  }).immediate();
  // Never remove photo files before the inventory transaction commits.
  removeUnreferencedPhotoFiles(photoIds);
  return { deleted: true };
}
export function deleteItem(id: string): { deleted: true } {
  getDatabase().transaction(() => {
    const db = getDatabase();
    requireItem(id);
    const affected = db.prepare("SELECT tote_id AS id FROM tote_contents WHERE item_id=? UNION SELECT original_tote_id AS id FROM removals WHERE item_id=? AND original_tote_id IS NOT NULL").all(id, id) as { id: string }[];
    db.prepare("DELETE FROM activities WHERE item_id=?").run(id);
    db.prepare("DELETE FROM removals WHERE item_id=?").run(id);
    db.prepare("DELETE FROM tote_contents WHERE item_id=?").run(id);
    db.prepare("DELETE FROM items WHERE id=?").run(id);
    // The existing FTS delete trigger removes search entries in the same transaction.
    for (const tote of affected) touchContents(tote.id);
  }).immediate();
  return { deleted: true };
}
export function addItems(toteId: string, input: unknown): ToteDetailDTO {
  const data = itemBatchInput.parse(input);
  getDatabase().transaction(() => {
    const tote = requireTote(toteId, true);
    for (const entry of data.items) {
      const id = randomUUID(), timestamp = now();
      getDrizzleDatabase().insert(items).values({ id, name: entry.name, notes: entry.notes || "", createdAt: timestamp, updatedAt: timestamp }).run();
      addStock(toteId, id, entry.quantity);
      logActivity("item_added", toteId, `Added ${entry.quantity} ${entry.name} to ${toteLabel(tote)}.`, requireItem(id), entry.quantity);
    }
    touchContents(toteId);
  }).immediate();
  return getTote(toteId);
}
export function updateItem(itemId: string, input: unknown): ToteDetailDTO {
  const data = itemEditInput.parse(input);
  getDatabase().transaction(() => {
    const tote = requireTote(data.toteId, true), item = requireItem(itemId), oldQuantity = requirePlacement(itemId, data.toteId);
    const name = data.name ?? item.name, notes = data.notes ?? item.notes, quantity = data.quantity ?? oldQuantity;
    if (name === item.name && notes === item.notes && quantity === oldQuantity) return;
    getDatabase().prepare("UPDATE items SET name=?,notes=?,updated_at=? WHERE id=?").run(name, notes, now(), itemId);
    getDatabase().prepare("UPDATE tote_contents SET stored_quantity=? WHERE tote_id=? AND item_id=?").run(quantity, data.toteId, itemId);
    if (name !== item.name || notes !== item.notes) {
      const placements = getDatabase().prepare("SELECT c.tote_id AS id FROM tote_contents c JOIN totes t ON t.id=c.tote_id WHERE c.item_id=? AND t.archived_at IS NULL").all(itemId) as { id: string }[];
      for (const placement of placements) touchContents(placement.id);
    } else touchContents(data.toteId);
    logActivity("item_updated", data.toteId, quantity !== oldQuantity ? `Corrected ${name} in ${toteLabel(tote)} from ${oldQuantity} to ${quantity}.` : `Updated ${name} in ${toteLabel(tote)}.`, { ...item, name }, quantity);
  }).immediate();
  return getTote(data.toteId);
}
export function takeItem(itemId: string, input: unknown): ToteDetailDTO {
  const data = takeInput.parse(input);
  getDatabase().transaction(() => {
    const tote = requireTote(data.toteId, true), item = requireItem(itemId), quantity = requirePlacement(itemId, data.toteId);
    if (data.quantity > quantity) throw new DomainError(409, "There are not enough of this item in the tote.");
    getDatabase().prepare("UPDATE tote_contents SET stored_quantity=stored_quantity-? WHERE tote_id=? AND item_id=?").run(data.quantity, data.toteId, itemId);
    const timestamp = now();
    getDatabase().prepare("INSERT INTO removals(id,item_id,original_tote_id,original_tote_code,original_tote_name,quantity,outstanding_quantity,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(randomUUID(), itemId, data.toteId, tote.code, tote.name, data.quantity, data.quantity, timestamp, timestamp);
    touchContents(data.toteId);
    logActivity("item_taken", data.toteId, `Took ${data.quantity} ${item.name} out of ${toteLabel(tote)}.`, item, data.quantity);
  }).immediate();
  return getTote(data.toteId);
}
export function moveItem(itemId: string, input: unknown): ToteDetailDTO {
  const data = moveInput.parse(input);
  if (data.sourceToteId === data.destinationToteId) throw new DomainError(400, "Choose a different destination tote.");
  getDatabase().transaction(() => {
    const source = requireTote(data.sourceToteId, true), destination = requireTote(data.destinationToteId, true), item = requireItem(itemId), quantity = requirePlacement(itemId, data.sourceToteId);
    if (data.quantity > quantity) throw new DomainError(409, "There are not enough of this item in the source tote.");
    addStock(data.destinationToteId, itemId, data.quantity);
    getDatabase().prepare("UPDATE tote_contents SET stored_quantity=stored_quantity-? WHERE tote_id=? AND item_id=?").run(data.quantity, data.sourceToteId, itemId);
    touchContents(data.sourceToteId); touchContents(data.destinationToteId);
    logActivity("item_moved", data.sourceToteId, `Moved ${data.quantity} ${item.name} from ${toteLabel(source)} to ${toteLabel(destination)}.`, item, data.quantity, data.destinationToteId);
  }).immediate();
  return getTote(data.sourceToteId);
}
export function returnItem(removalId: string, input: unknown): ToteDetailDTO {
  const data = returnInput.parse(input);
  const detailToteId = getDatabase().transaction(() => {
    const removal = getDatabase().prepare("SELECT id,item_id AS itemId,original_tote_id AS originalToteId,original_tote_code AS originalToteCode,original_tote_name AS originalToteName,quantity,outstanding_quantity AS outstandingQuantity,created_at AS createdAt,updated_at AS updatedAt FROM removals WHERE id=?").get(removalId) as RemovalRow | undefined;
    if (!removal) throw new DomainError(404, "This taken-out item could not be found.");
    if (data.quantity > removal.outstandingQuantity) throw new DomainError(409, "That quantity exceeds the number still taken out.");
    const original = removal.originalToteId ? requireTote(removal.originalToteId) : null;
    const destinationId = data.destinationToteId || original?.id;
    if (!destinationId) throw new DomainError(400, "Choose a destination tote for this unassigned item.");
    const destination = requireTote(destinationId, true), item = requireItem(removal.itemId);
    addStock(destinationId, item.id, data.quantity);
    getDatabase().prepare("UPDATE removals SET outstanding_quantity=outstanding_quantity-?,updated_at=? WHERE id=?").run(data.quantity, now(), removalId);
    if (original) touchContents(original.id);
    if (destinationId !== original?.id) touchContents(destinationId);
    const originalLabel = original ? toteLabel(original) : removal.originalToteCode ? `${removal.originalToteCode} (${removal.originalToteName || "deleted tote"})` : "a deleted tote";
    logActivity(destinationId === original?.id ? "item_returned" : "item_relocated", original?.id || destinationId, destinationId === original?.id ? `Returned ${data.quantity} ${item.name} to ${toteLabel(destination)}.` : `Put ${data.quantity} taken-out ${item.name} from ${originalLabel} into ${toteLabel(destination)}.`, item, data.quantity, original && destinationId !== original.id ? destinationId : undefined);
    return original?.id || destinationId;
  }).immediate();
  return getTote(detailToteId);
}
export function recordPhoto(toteId: string, input: unknown): ToteDetailDTO {
  const data = z.object({ id: z.string().uuid(), originalName: z.string().min(1).max(255), mimeType: z.string().min(1).max(100) }).strict().parse(input);
  getDatabase().transaction(() => {
    const tote = requireTote(toteId, true), timestamp = new Date(Math.max(Date.now(), Date.parse(tote.contentsUpdatedAt) + 1)).toISOString();
    if (getDatabase().prepare("SELECT id FROM photos WHERE id=?").get(data.id)) throw new DomainError(409, "This photo has already been recorded.");
    getDatabase().prepare("INSERT INTO photos(id,tote_id,original_name,mime_type,created_at) VALUES(?,?,?,?,?)").run(data.id, toteId, data.originalName, data.mimeType, timestamp);
    getDatabase().prepare("UPDATE totes SET current_photo_id=?,updated_at=? WHERE id=?").run(data.id, timestamp, toteId);
    logActivity("photo_updated", toteId, `Updated the contents photo for ${toteLabel(tote)}.`);
  }).immediate();
  return getTote(toteId);
}
export function getPhoto(id: string): PhotoRecordDTO {
  const row = getDatabase().prepare("SELECT id,tote_id AS toteId,original_name AS originalName,mime_type AS mimeType,created_at AS createdAt FROM photos WHERE id=?").get(id) as PhotoRecordDTO | undefined;
  if (!row) throw new DomainError(404, "This photo could not be found.");
  return row;
}
export function searchInventory(query: string): SearchDTO {
  const q = z.string().trim().max(200).parse(query), db = getDatabase();
  const tokens = q.match(/[\p{L}\p{N}]+/gu) || [];
  const match = tokens.slice(0, 20).map(token => `"${token}"*`).join(" AND ");
  const escaped = `%${q.replace(/[\\%_]/g, character => `\\${character}`)}%`;
  const condition = q ? ` AND (${tokens.length ? "i.rowid IN (SELECT rowid FROM item_search WHERE item_search MATCH ?)" : "0"} OR t.code LIKE ? ESCAPE '\\' OR t.name LIKE ? ESCAPE '\\')` : "";
  const parameters = q ? [...(tokens.length ? [match] : []), escaped, escaped] : [];
  const rows = db.prepare(`SELECT i.id AS itemId,i.name,t.id AS toteId,t.code AS toteCode,t.name AS toteName,c.stored_quantity AS quantity,COALESCE(r.outstandingQuantity,0) AS outstandingQuantity,t.current_photo_id AS photoId FROM tote_contents c JOIN items i ON i.id=c.item_id JOIN totes t ON t.id=c.tote_id LEFT JOIN (SELECT item_id,original_tote_id,SUM(outstanding_quantity) AS outstandingQuantity FROM removals GROUP BY item_id,original_tote_id) r ON r.item_id=c.item_id AND r.original_tote_id=c.tote_id WHERE t.archived_at IS NULL AND i.archived_at IS NULL AND (c.stored_quantity>0 OR COALESCE(r.outstandingQuantity,0)>0)${condition} ORDER BY i.name COLLATE NOCASE,t.code LIMIT 500`).all(...parameters) as (Omit<SearchResultDTO, "photoThumbUrl"> & { photoId: string | null })[];
  const results: SearchResultDTO[] = rows.map(({ photoId, ...row }) => ({ ...row, photoThumbUrl: photoId ? `/api/photos/${photoId}?size=thumb` : null }));
  const matchingTotes = db.prepare(`SELECT ${toteColumns} FROM totes WHERE archived_at IS NULL${q ? " AND (code LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR notes LIKE ? ESCAPE '\\')" : ""} ORDER BY CAST(SUBSTR(code,2) AS INTEGER)`).all(...(q ? [escaped, escaped, escaped] : [])) as ToteRow[];
  return { results, totes: matchingTotes.map(toteDTO) };
}
export function getExportSnapshot() {
  const db = getDatabase();
  return db.transaction(() => ({
    formatVersion: 3, exportedAt: now(),
    totes: db.prepare(`SELECT ${toteColumns} FROM totes ORDER BY CAST(SUBSTR(code,2) AS INTEGER)`).all(),
    items: db.prepare(`SELECT ${itemColumns} FROM items ORDER BY created_at,rowid`).all(),
    contents: db.prepare("SELECT tote_id AS toteId,item_id AS itemId,stored_quantity AS quantity FROM tote_contents ORDER BY tote_id,item_id").all(),
    removals: db.prepare("SELECT id,item_id AS itemId,original_tote_id AS originalToteId,original_tote_code AS originalToteCode,original_tote_name AS originalToteName,quantity,outstanding_quantity AS outstandingQuantity,created_at AS createdAt,updated_at AS updatedAt FROM removals ORDER BY created_at,rowid").all(),
    activities: (db.prepare("SELECT id,type,tote_id AS toteId,other_tote_id AS otherToteId,item_id AS itemId,item_name AS itemName,quantity,details,created_at AS createdAt FROM activities ORDER BY created_at,rowid").all() as { details: string }[]).map(row => ({ ...row, details: JSON.parse(row.details) as Record<string, unknown> })),
    photos: db.prepare("SELECT id,tote_id AS toteId,original_name AS originalName,mime_type AS mimeType,created_at AS createdAt FROM photos ORDER BY created_at,rowid").all(),
    aiSuggestionRuns: db.prepare("SELECT * FROM ai_suggestion_runs ORDER BY created_at,rowid").all(),
    settings: db.prepare("SELECT key,value FROM settings ORDER BY key").all(),
  }))();
}
