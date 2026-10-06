import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { getDatabase } from "./db";
import { addItems, DomainError, getTote } from "./inventory";
import type { AIRunDTO, AISuggestionDTO, AIStateDTO, ToteDetailDTO } from "./contracts";
import { resolveAIModel } from "./config";

export const AI_MODEL = resolveAIModel();
export const startAIInput = z.object({
  photoId: z.string().uuid(), contentsUpdatedAt: z.string().datetime(), force: z.boolean().default(false),
}).strict();
export const acceptAIInput = z.object({
  runId: z.string().uuid(),
  items: z.array(z.object({ suggestionId: z.string().uuid(), name: z.string().trim().min(1).max(200), quantity: z.number().int().min(1).max(100000) }).strict()).min(1).max(30),
}).strict();
export const dismissAIInput = z.object({ runId: z.string().uuid(), suggestionId: z.string().uuid().optional() }).strict();
export const restoreAIInput = z.object({ runId: z.string().uuid() }).strict();
export const modelSuggestions = z.object({
  items: z.array(z.object({ name: z.string().trim().min(1).max(200), quantity: z.number().int().min(1).max(100000), note: z.string().trim().max(160) }).strict()).max(30),
}).strict();
type RunRow = {
  id: string; tote_id: string; photo_id: string; contents_updated_at: string; status: AIRunDTO["status"];
  model: string; suggestions_json: string; error: string | null; created_at: string; expires_at: string;
  accepted_payload_hash: string | null; accepted_count: number;
  dismissed_at: string | null; dismissed_ids_json: string;
};
const clock = () => new Date().toISOString();
const inferenceLeasePrefix = "ai_inference_lease:";
function releaseInferenceLease(id: string) {
  getDatabase().prepare("DELETE FROM settings WHERE key=?").run(inferenceLeasePrefix + id);
}
export function normalizedItemName(name: string) { return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase(); }
function displayName(name: string) { return name.trim().replace(/\s+/gu, " "); }
export function aiEnabled() { return Boolean(process.env.AI_URL); }
function expireRuns() {
  // The processing lease begins at claim. Waiting photos never expire.
  getDatabase().prepare("UPDATE ai_suggestion_runs SET status='failed',error=?,updated_at=? WHERE status='running' AND expires_at<=?")
    .run("Analysis was interrupted or took too long. Try again.", clock(), clock());
  // A deleted tote has no run row, but its request may still be using the model.
  // Keep that lease until processing finishes or its bounded expiry is reached.
  getDatabase().prepare("DELETE FROM settings WHERE key GLOB ? AND (value<=? OR EXISTS (SELECT 1 FROM ai_suggestion_runs r WHERE r.id=substr(settings.key,?) AND r.status<>'running'))")
    .run(inferenceLeasePrefix + "*", Date.now(), inferenceLeasePrefix.length + 1);
}
function discardObsoleteQueuedPhotos() {
  getDatabase().prepare("UPDATE ai_suggestion_runs AS r SET status='failed',error=?,updated_at=? WHERE status='queued' AND NOT EXISTS (SELECT 1 FROM totes t WHERE t.id=r.tote_id AND t.current_photo_id=r.photo_id AND t.archived_at IS NULL)")
    .run("This photo was replaced or its tote was archived.", clock());
}
function rowToDTO(row: RunRow, detail: ToteDetailDTO): AIRunDTO {
  const position = row.status === "queued" ? getDatabase().prepare("SELECT COUNT(*) AS position FROM ai_suggestion_runs pending JOIN ai_suggestion_runs target ON target.id=? WHERE pending.status='queued' AND (pending.created_at<target.created_at OR (pending.created_at=target.created_at AND pending.rowid<=target.rowid))").get(row.id) as { position: number } : null;
  return {
    id: row.id, toteId: row.tote_id, photoId: row.photo_id, contentsUpdatedAt: row.contents_updated_at,
    status: row.status, model: row.model, suggestions: JSON.parse(row.suggestions_json) as AISuggestionDTO[],
    stale: row.photo_id !== detail.tote.photo?.id || row.contents_updated_at !== detail.tote.contentsUpdatedAt,
    queuePosition: position?.position ?? null,
    error: row.error, createdAt: row.created_at, acceptedCount: row.accepted_count,
    dismissed: row.dismissed_at !== null, dismissedSuggestionIds: JSON.parse(row.dismissed_ids_json) as string[],
  };
}
export function getAIState(toteId: string): AIStateDTO {
  const detail = getTote(toteId);
  expireRuns();
  const row = getDatabase().prepare("SELECT * FROM ai_suggestion_runs WHERE tote_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(toteId) as RunRow | undefined;
  return { enabled: aiEnabled(), run: row ? rowToDTO(row, detail) : null };
}
export function createAIRun(toteId: string, input: unknown): { state: AIStateDTO; created: boolean } {
  const data = startAIInput.parse(input);
  if (!aiEnabled()) throw new DomainError(503, "Local AI is unavailable. You can still add items manually.");
  let created = false;
  getDatabase().transaction(() => {
    const detail = getTote(toteId);
    if (detail.tote.archivedAt) throw new DomainError(409, "Restore this tote before analyzing its photo.");
    if (!detail.tote.photo) throw new DomainError(409, "Add a contents photo first.");
    if (detail.tote.photo.id !== data.photoId || detail.tote.contentsUpdatedAt !== data.contentsUpdatedAt) {
      throw new DomainError(409, "The photo or contents changed. Refresh the tote and try again.");
    }
    expireRuns();
    const latest = getDatabase().prepare("SELECT * FROM ai_suggestion_runs WHERE tote_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(toteId) as RunRow | undefined;
    const matches = latest?.photo_id === data.photoId && latest.contents_updated_at === data.contentsUpdatedAt;
    if (matches && (latest.status === "queued" || latest.status === "running" || (!data.force && latest.status === "ready"))) return;
    // A replacement joins the tail; other totes keep their FIFO order.
    // Preserve an active lease until its inference and cleanup finish.
    getDatabase().prepare("UPDATE ai_suggestion_runs SET status='failed',error=?,updated_at=? WHERE tote_id=? AND status='queued'")
      .run("Newer suggestions replaced this waiting photo.", clock(), toteId);
    const timestamp = clock();
    getDatabase().prepare("INSERT INTO ai_suggestion_runs(id,tote_id,photo_id,contents_updated_at,model,status,suggestions_json,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,'queued','[]',?,?,?)")
      .run(randomUUID(), toteId, data.photoId, data.contentsUpdatedAt, AI_MODEL, timestamp, timestamp, timestamp);
    created = true;
  }).immediate();
  return { state: getAIState(toteId), created };
}
export function nextQueuedAIRunId(): string | null {
  return getDatabase().transaction(() => {
    expireRuns();
    discardObsoleteQueuedPhotos();
    if (getDatabase().prepare("SELECT id FROM ai_suggestion_runs WHERE status='running' LIMIT 1").get()
      || getDatabase().prepare("SELECT key FROM settings WHERE key GLOB ? AND value>? LIMIT 1").get(inferenceLeasePrefix + "*", Date.now())) return null;
    const next = getDatabase().prepare("SELECT id FROM ai_suggestion_runs WHERE status='queued' ORDER BY created_at,rowid LIMIT 1").get() as { id: string } | undefined;
    return next?.id ?? null;
  }).immediate();
}
export function claimAIRun(id: string): RunRow | null {
  return getDatabase().transaction(() => {
    const next = nextQueuedAIRunId();
    if (next !== id) return null;
    const row = getDatabase().prepare("SELECT * FROM ai_suggestion_runs WHERE id=?").get(id) as RunRow;
    const detail = getTote(row.tote_id);
    // Manual edits made while waiting become the acceptance snapshot.
    const timestamp = clock();
    const expiresAt = Date.now() + 360000;
    getDatabase().prepare("UPDATE ai_suggestion_runs SET status='running',contents_updated_at=?,updated_at=?,expires_at=? WHERE id=? AND status='queued'")
      .run(detail.tote.contentsUpdatedAt, timestamp, new Date(expiresAt).toISOString(), id);
    getDatabase().prepare("INSERT INTO settings(key,value) VALUES(?,?)").run(inferenceLeasePrefix + id, expiresAt);
    return getDatabase().prepare("SELECT * FROM ai_suggestion_runs WHERE id=?").get(id) as RunRow;
  }).immediate();
}
export function completeAIRun(id: string, input: unknown) {
  const parsed = modelSuggestions.parse(input);
  const seen = new Set<string>();
  const suggestions = parsed.items.flatMap(item => {
    const name = displayName(item.name), key = normalizedItemName(name);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: randomUUID(), name, quantity: item.quantity, note: item.note }];
  });
  getDatabase().transaction(() => {
    expireRuns();
    releaseInferenceLease(id);
    const row = getDatabase().prepare("SELECT * FROM ai_suggestion_runs WHERE id=? AND status='running'").get(id) as RunRow | undefined;
    if (!row) return;
    const detail = getTote(row.tote_id);
    if (detail.tote.archivedAt || row.photo_id !== detail.tote.photo?.id) {
      failAIRun(id, "This photo was replaced or its tote was archived.");
      return;
    }
    if (row.contents_updated_at !== detail.tote.contentsUpdatedAt) {
      failAIRun(id, "The contents changed during analysis. Try again or upload a current photo.");
      return;
    }
    getDatabase().prepare("UPDATE ai_suggestion_runs SET status='ready',suggestions_json=?,error=NULL,updated_at=? WHERE id=? AND status='running'")
      .run(JSON.stringify(suggestions), clock(), id);
  }).immediate();
}
export function failAIRun(id: string, error: string) {
  getDatabase().transaction(() => {
    getDatabase().prepare("UPDATE ai_suggestion_runs SET status='failed',error=?,updated_at=? WHERE id=? AND status IN ('queued','running')")
      .run(error.slice(0, 240), clock(), id);
    releaseInferenceLease(id);
  }).immediate();
}
function currentReview(toteId: string, runId: string): RunRow {
  getTote(toteId);
  const row = getDatabase().prepare("SELECT * FROM ai_suggestion_runs WHERE id=? AND tote_id=?").get(runId, toteId) as RunRow | undefined;
  if (!row) throw new DomainError(404, "These suggestions could not be found.");
  const latest = getDatabase().prepare("SELECT id FROM ai_suggestion_runs WHERE tote_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(toteId) as { id: string };
  if (latest.id !== row.id) throw new DomainError(409, "Newer suggestions are available. Reload the tote first.");
  return row;
}
export function dismissAISuggestions(toteId: string, input: unknown): AIStateDTO {
  const data = dismissAIInput.parse(input);
  getDatabase().transaction(() => {
    const row = currentReview(toteId, data.runId);
    const timestamp = clock();
    if (!data.suggestionId) {
      // Visibility is independent from processing. A hidden analysis keeps its exclusive lease.
      getDatabase().prepare("UPDATE ai_suggestion_runs SET dismissed_at=COALESCE(dismissed_at,?),updated_at=? WHERE id=?")
        .run(timestamp, timestamp, row.id);
      return;
    }
    if (row.status !== "ready") throw new DomainError(409, "Only completed suggestions can be dismissed individually.");
    const suggestions = JSON.parse(row.suggestions_json) as AISuggestionDTO[];
    if (!suggestions.some(item => item.id === data.suggestionId)) throw new DomainError(404, "This suggestion could not be found.");
    const dismissed = new Set(JSON.parse(row.dismissed_ids_json) as string[]);
    dismissed.add(data.suggestionId);
    const allDismissed = suggestions.every(item => dismissed.has(item.id));
    getDatabase().prepare("UPDATE ai_suggestion_runs SET dismissed_ids_json=?,dismissed_at=?,updated_at=? WHERE id=?")
      .run(JSON.stringify([...dismissed].sort()), row.dismissed_at ?? (allDismissed ? timestamp : null), timestamp, row.id);
  }).immediate();
  return getAIState(toteId);
}
export function restoreAISuggestions(toteId: string, input: unknown): AIStateDTO {
  const data = restoreAIInput.parse(input);
  getDatabase().transaction(() => {
    const row = currentReview(toteId, data.runId);
    getDatabase().prepare("UPDATE ai_suggestion_runs SET dismissed_at=NULL,dismissed_ids_json='[]',updated_at=? WHERE id=?")
      .run(clock(), row.id);
  }).immediate();
  return getAIState(toteId);
}
export function acceptAISuggestions(toteId: string, input: unknown): { detail: ToteDetailDTO; ai: AIStateDTO } {
  const parsed = acceptAIInput.parse(input);
  const selected = parsed.items.map(item => ({ ...item, name: displayName(item.name) })).sort((a,b) => a.suggestionId.localeCompare(b.suggestionId));
  const hash = createHash("sha256").update(JSON.stringify(selected)).digest("hex");
  getDatabase().transaction(() => {
    const row = getDatabase().prepare("SELECT * FROM ai_suggestion_runs WHERE id=? AND tote_id=?").get(parsed.runId, toteId) as RunRow | undefined;
    if (!row) throw new DomainError(404, "These suggestions could not be found.");
    if (row.status === "accepted") {
      if (row.accepted_payload_hash === hash) return;
      throw new DomainError(409, "This review has already been added. Analyze the photo again for a new review.");
    }
    const latest = getDatabase().prepare("SELECT id FROM ai_suggestion_runs WHERE tote_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(toteId) as { id: string };
    if (latest.id !== row.id) throw new DomainError(409, "Newer suggestions are available. Reload the tote before adding items.");
    const detail = getTote(toteId);
    if (detail.tote.archivedAt) throw new DomainError(409, "Restore this tote before adding suggestions.");
    if (row.status !== "ready") throw new DomainError(409, "Wait for the suggestions to finish first.");
    if (row.dismissed_at) throw new DomainError(409, "Show these suggestions again before adding items.");
    if (row.photo_id !== detail.tote.photo?.id || row.contents_updated_at !== detail.tote.contentsUpdatedAt) {
      throw new DomainError(409, "The photo or contents changed. Analyze the current photo again before adding suggestions.");
    }
    const suggestions = JSON.parse(row.suggestions_json) as AISuggestionDTO[];
    const validIds = new Set(suggestions.map(item => item.id));
    const dismissedIds = new Set(JSON.parse(row.dismissed_ids_json) as string[]);
    const selectedIds = new Set<string>(), names = new Set<string>();
    const existing = new Set(detail.items.map(item => normalizedItemName(item.name)));
    for (const item of selected) {
      if (!validIds.has(item.suggestionId) || selectedIds.has(item.suggestionId)) throw new DomainError(400, "Choose each suggestion only once.");
      if (dismissedIds.has(item.suggestionId)) throw new DomainError(409, "Restore this dismissed suggestion before adding it.");
      selectedIds.add(item.suggestionId);
      const key = normalizedItemName(item.name);
      if (names.has(key)) throw new DomainError(409, "Two selected suggestions have the same name. Keep one and check its quantity.");
      if (existing.has(key)) throw new DomainError(409, item.name + " is already listed in this tote. Edit the existing item instead.");
      names.add(key);
    }
    addItems(toteId, { items: selected.map(item => ({ name: item.name, quantity: item.quantity })) });
    const timestamp = clock();
    getDatabase().prepare("UPDATE ai_suggestion_runs SET status='accepted',accepted_payload_hash=?,accepted_count=?,accepted_at=?,updated_at=? WHERE id=?")
      .run(hash, selected.length, timestamp, timestamp, row.id);
    getDatabase().prepare("INSERT INTO activities(id,type,tote_id,details,created_at) VALUES(?,?,?,?,?)")
      .run(randomUUID(), "ai_suggestions_added", toteId, JSON.stringify({ description: "Added " + selected.length + " reviewed AI item " + (selected.length === 1 ? "type" : "types") + " to " + detail.tote.code + " (" + detail.tote.name + ").", runId: row.id, sourcePhotoId: row.photo_id }), timestamp);
  }).immediate();
  return { detail: getTote(toteId), ai: getAIState(toteId) };
}
