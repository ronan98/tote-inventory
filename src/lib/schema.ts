import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
export const totes = sqliteTable("totes", {
  id: text("id").primaryKey(), code: text("code").notNull().unique(), name: text("name").notNull(), notes: text("notes").notNull().default(""),
  currentPhotoId: text("current_photo_id").references((): AnySQLiteColumn => photos.id), archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), contentsUpdatedAt: text("contents_updated_at").notNull(),
});
export const items = sqliteTable("items", {
  id: text("id").primaryKey(), name: text("name").notNull(), notes: text("notes").notNull().default(""), archivedAt: text("archived_at"), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
});
export const toteContents = sqliteTable("tote_contents", {
  toteId: text("tote_id").notNull().references(() => totes.id), itemId: text("item_id").notNull().references(() => items.id), storedQuantity: integer("stored_quantity").notNull().default(0),
}, t => [primaryKey({ columns: [t.toteId, t.itemId] }), index("contents_item_idx").on(t.itemId), check("stored_quantity_nonnegative", sql`${t.storedQuantity} >= 0`)]);
export const removals = sqliteTable("removals", {
  id: text("id").primaryKey(), itemId: text("item_id").notNull().references(() => items.id), originalToteId: text("original_tote_id").references(() => totes.id),
  originalToteCode: text("original_tote_code"), originalToteName: text("original_tote_name"),
  quantity: integer("quantity").notNull(), outstandingQuantity: integer("outstanding_quantity").notNull(), createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(),
}, t => [index("removals_tote_idx").on(t.originalToteId), index("removals_item_idx").on(t.itemId), check("removal_quantity_positive", sql`${t.quantity} > 0`), check("outstanding_quantity_valid", sql`${t.outstandingQuantity} >= 0 AND ${t.outstandingQuantity} <= ${t.quantity}`)]);
export const activities = sqliteTable("activities", {
  id: text("id").primaryKey(), type: text("type").notNull(), toteId: text("tote_id").references(() => totes.id), otherToteId: text("other_tote_id").references(() => totes.id),
  itemId: text("item_id").references(() => items.id), itemName: text("item_name"), quantity: integer("quantity"), details: text("details", { mode: "json" }).$type<Record<string, unknown>>().notNull(), createdAt: text("created_at").notNull(),
}, t => [index("activities_tote_idx").on(t.toteId, t.createdAt)]);
export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(), toteId: text("tote_id").notNull().references(() => totes.id), originalName: text("original_name").notNull(), mimeType: text("mime_type").notNull(), createdAt: text("created_at").notNull(),
}, t => [index("photos_tote_idx").on(t.toteId)]);
export const settings = sqliteTable("settings", { key: text("key").primaryKey(), value: integer("value").notNull() });

export const aiSuggestionRuns = sqliteTable("ai_suggestion_runs", {
  id: text("id").primaryKey(), toteId: text("tote_id").notNull().references(() => totes.id),
  photoId: text("photo_id").notNull().references(() => photos.id),
  contentsUpdatedAt: text("contents_updated_at").notNull(), model: text("model").notNull(),
  status: text("status", { enum: ["queued", "running", "ready", "failed", "accepted"] }).notNull(),
  suggestionsJson: text("suggestions_json").notNull().default("[]"), error: text("error"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), expiresAt: text("expires_at").notNull(),
  acceptedPayloadHash: text("accepted_payload_hash"), acceptedCount: integer("accepted_count").notNull().default(0), acceptedAt: text("accepted_at"),
  dismissedAt: text("dismissed_at"), dismissedIdsJson: text("dismissed_ids_json").notNull().default("[]"),
}, table => [
  index("ai_runs_tote_idx").on(table.toteId, table.createdAt),
  index("ai_queue_order_idx").on(table.status, table.createdAt),
  uniqueIndex("ai_single_queued_tote").on(table.toteId).where(sql`${table.status} = 'queued'`),
  uniqueIndex("ai_single_active_job").on(sql`(1)`).where(sql`${table.status} = 'running'`),
]);
