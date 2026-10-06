import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import * as schema from "./schema";
const initialMigration = `
CREATE TABLE totes (id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', current_photo_id TEXT REFERENCES photos(id), archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, contents_updated_at TEXT NOT NULL);
CREATE TABLE items (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE tote_contents (tote_id TEXT NOT NULL REFERENCES totes(id), item_id TEXT NOT NULL REFERENCES items(id), stored_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stored_quantity >= 0), PRIMARY KEY(tote_id,item_id));
CREATE INDEX contents_item_idx ON tote_contents(item_id);
CREATE TABLE removals (id TEXT PRIMARY KEY NOT NULL, item_id TEXT NOT NULL REFERENCES items(id), original_tote_id TEXT NOT NULL REFERENCES totes(id), quantity INTEGER NOT NULL CHECK(quantity > 0), outstanding_quantity INTEGER NOT NULL CHECK(outstanding_quantity >= 0 AND outstanding_quantity <= quantity), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX removals_tote_idx ON removals(original_tote_id);
CREATE INDEX removals_item_idx ON removals(item_id);
CREATE TABLE activities (id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, tote_id TEXT NOT NULL REFERENCES totes(id), other_tote_id TEXT REFERENCES totes(id), item_id TEXT REFERENCES items(id), item_name TEXT, quantity INTEGER, details TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX activities_tote_idx ON activities(tote_id,created_at);
CREATE TABLE photos (id TEXT PRIMARY KEY NOT NULL, tote_id TEXT NOT NULL REFERENCES totes(id), original_name TEXT NOT NULL, mime_type TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX photos_tote_idx ON photos(tote_id);
CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value INTEGER NOT NULL);
INSERT INTO settings(key,value) VALUES ('next_tote_number',1);
CREATE VIRTUAL TABLE item_search USING fts5(name,notes,content='items',content_rowid='rowid',tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER items_search_insert AFTER INSERT ON items BEGIN INSERT INTO item_search(rowid,name,notes) VALUES(new.rowid,new.name,new.notes); END;
CREATE TRIGGER items_search_delete AFTER DELETE ON items BEGIN INSERT INTO item_search(item_search,rowid,name,notes) VALUES('delete',old.rowid,old.name,old.notes); END;
CREATE TRIGGER items_search_update AFTER UPDATE OF name,notes ON items BEGIN INSERT INTO item_search(item_search,rowid,name,notes) VALUES('delete',old.rowid,old.name,old.notes); INSERT INTO item_search(rowid,name,notes) VALUES(new.rowid,new.name,new.notes); END;
`;
const aiMigration = `
CREATE TABLE ai_suggestion_runs (
  id TEXT PRIMARY KEY NOT NULL, tote_id TEXT NOT NULL REFERENCES totes(id),
  photo_id TEXT NOT NULL REFERENCES photos(id), contents_updated_at TEXT NOT NULL,
  model TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','running','ready','failed','accepted')),
  suggestions_json TEXT NOT NULL DEFAULT '[]', error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL, accepted_payload_hash TEXT, accepted_count INTEGER NOT NULL DEFAULT 0, accepted_at TEXT
);
CREATE INDEX ai_runs_tote_idx ON ai_suggestion_runs(tote_id,created_at);
CREATE UNIQUE INDEX ai_single_active_job ON ai_suggestion_runs ((1)) WHERE status IN ('queued','running');
`;

const queueMigration = `
DROP INDEX ai_single_active_job;
CREATE UNIQUE INDEX ai_single_active_job ON ai_suggestion_runs ((1)) WHERE status='running';
CREATE UNIQUE INDEX ai_single_queued_tote ON ai_suggestion_runs (tote_id) WHERE status='queued';
CREATE INDEX ai_queue_order_idx ON ai_suggestion_runs(status,created_at);
`;
const cleanupMigration = `
CREATE TABLE removals_v4 (id TEXT PRIMARY KEY NOT NULL, item_id TEXT NOT NULL REFERENCES items(id), original_tote_id TEXT REFERENCES totes(id), original_tote_code TEXT, original_tote_name TEXT, quantity INTEGER NOT NULL CHECK(quantity > 0), outstanding_quantity INTEGER NOT NULL CHECK(outstanding_quantity >= 0 AND outstanding_quantity <= quantity), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
INSERT INTO removals_v4 SELECT r.id,r.item_id,r.original_tote_id,t.code,t.name,r.quantity,r.outstanding_quantity,r.created_at,r.updated_at FROM removals r LEFT JOIN totes t ON t.id=r.original_tote_id ORDER BY r.rowid;
DROP TABLE removals;
ALTER TABLE removals_v4 RENAME TO removals;
CREATE INDEX removals_tote_idx ON removals(original_tote_id);
CREATE INDEX removals_item_idx ON removals(item_id);
CREATE TABLE activities_v4 (id TEXT PRIMARY KEY NOT NULL, type TEXT NOT NULL, tote_id TEXT REFERENCES totes(id), other_tote_id TEXT REFERENCES totes(id), item_id TEXT REFERENCES items(id), item_name TEXT, quantity INTEGER, details TEXT NOT NULL, created_at TEXT NOT NULL);
INSERT INTO activities_v4 SELECT * FROM activities ORDER BY rowid;
DROP TABLE activities;
ALTER TABLE activities_v4 RENAME TO activities;
CREATE INDEX activities_tote_idx ON activities(tote_id,created_at);
ALTER TABLE ai_suggestion_runs ADD COLUMN dismissed_at TEXT;
ALTER TABLE ai_suggestion_runs ADD COLUMN dismissed_ids_json TEXT NOT NULL DEFAULT '[]';
`;
let connection: { file: string; sqlite: Database.Database; orm: ReturnType<typeof drizzle<typeof schema>> } | undefined;
export function getDataDirectory(): string { return path.resolve(/* turbopackIgnore: true */ process.env.INVENTORY_DATA_DIR || path.join(process.cwd(), "data")); }
function initialize(): NonNullable<typeof connection> {
  const directory = getDataDirectory(), file = path.join(directory, "inventory.sqlite");
  if (connection?.file === file && connection.sqlite.open) return connection;
  if (connection?.sqlite.open) connection.sqlite.close();
  mkdirSync(path.join(directory, "photos"), { recursive: true, mode: 0o700 });
  const sqlite = new Database(file);
  chmodSync(file, 0o600);
  try {
    sqlite.pragma("busy_timeout = 5000"); sqlite.pragma("foreign_keys = ON"); sqlite.pragma("journal_mode = WAL"); sqlite.pragma("synchronous = NORMAL");
    // App and worker may open the database together: inspect and migrate
    // while holding the same write lock.
    sqlite.transaction(() => {
      let version = sqlite.pragma("user_version", { simple: true }) as number;
      if (version > 4) throw new Error("This database requires a newer application version.");
      if (version === 0) { sqlite.exec(initialMigration); sqlite.pragma("user_version = 1"); version = 1; }
      if (version < 2) { sqlite.exec(aiMigration); sqlite.pragma("user_version = 2"); version = 2; }
      if (version < 3) { sqlite.exec(queueMigration); sqlite.pragma("user_version = 3"); version = 3; }
      if (version < 4) { sqlite.exec(cleanupMigration); sqlite.pragma("user_version = 4"); }
    }).immediate();
    connection = { file, sqlite, orm: drizzle(sqlite, { schema }) }; return connection;
  } catch (error) { sqlite.close(); throw error; }
}
export function getDatabase(): Database.Database { return initialize().sqlite; }
export function getDrizzleDatabase() { return initialize().orm; }
export function closeDatabase(): void { if (connection?.sqlite.open) connection.sqlite.close(); connection = undefined; }
