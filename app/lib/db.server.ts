import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// One SQLite file holds team notes plus the season index synced from RobotEvents.
// DATA_DIR defaults to ./data (gitignored); in Docker it is a mounted volume.
const DATA_DIR = path.resolve(process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data"));
const DB_FILE = path.join(DATA_DIR, "roborank.sqlite");
const LEGACY_DATA_DIR = path.join(process.cwd(), "app", "data");

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scouting_notes (
  id TEXT PRIMARY KEY,
  team_number TEXT NOT NULL,
  author_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  strengths TEXT NOT NULL,
  concerns TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS scouting_notes_team ON scouting_notes(team_number, created_at);

CREATE TABLE IF NOT EXISTS match_notes (
  event_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  team_number TEXT NOT NULL,
  author_name TEXT NOT NULL,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (event_id, match_id, team_number)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  start TEXT,
  end TEXT,
  season_id INTEGER,
  city TEXT,
  region TEXT,
  country TEXT,
  divisions TEXT NOT NULL DEFAULT '[]',
  synced_at TEXT,
  complete INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS events_start ON events(start);
CREATE INDEX IF NOT EXISTS events_sku ON events(sku);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL,
  division_id INTEGER NOT NULL,
  round INTEGER NOT NULL,
  instance INTEGER NOT NULL,
  matchnum INTEGER NOT NULL,
  name TEXT,
  time TEXT,
  red TEXT NOT NULL,
  blue TEXT NOT NULL,
  red_score INTEGER NOT NULL,
  blue_score INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS matches_event ON matches(event_id);

CREATE TABLE IF NOT EXISTS match_teams (
  match_id INTEGER NOT NULL,
  team_number TEXT NOT NULL,
  color TEXT NOT NULL,
  PRIMARY KEY (match_id, team_number)
);
CREATE INDEX IF NOT EXISTS match_teams_team ON match_teams(team_number);

CREATE TABLE IF NOT EXISTS skills (
  event_id INTEGER NOT NULL,
  team_number TEXT NOT NULL,
  type TEXT NOT NULL,
  score INTEGER NOT NULL,
  PRIMARY KEY (event_id, team_number, type)
);

CREATE TABLE IF NOT EXISTS team_ratings (
  team_number TEXT PRIMARY KEY,
  mu REAL NOT NULL,
  sigma REAL NOT NULL,
  trueskill REAL NOT NULL,
  matches INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  ties INTEGER NOT NULL,
  opr REAL,
  dpr REAL,
  ccwm REAL,
  skills_best INTEGER,
  skills_driver INTEGER,
  skills_programming INTEGER,
  trueskill_rank INTEGER
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type Global = typeof globalThis & { __roborankDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  const g = globalThis as Global;
  if (g.__roborankDb) return g.__roborankDb;

  mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);

  const version = Number(getMetaFrom(db, "schema_version") ?? 0);
  if (version < SCHEMA_VERSION) {
    importLegacyJsonNotes(db);
    setMetaOn(db, "schema_version", String(SCHEMA_VERSION));
  }

  g.__roborankDb = db;
  return db;
}

function getMetaFrom(db: DatabaseSync, key: string) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setMetaOn(db: DatabaseSync, key: string, value: string) {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function getMeta(key: string) {
  return getMetaFrom(getDb(), key);
}

export function setMeta(key: string, value: string) {
  setMetaOn(getDb(), key, value);
}

/** Runs `work` inside a transaction (node:sqlite has no transaction helper). */
export function transaction<T>(work: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = work(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function readLegacyJson(fileName: string): unknown[] {
  const file = path.join(LEGACY_DATA_DIR, fileName);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// The app used to keep notes in app/data/*.json; copy them in once so nothing is lost.
function importLegacyJsonNotes(db: DatabaseSync) {
  const insertNote = db.prepare(
    `INSERT OR IGNORE INTO scouting_notes (id, team_number, author_name, subject, strengths, concerns, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const raw of readLegacyJson("scouting-notes.json")) {
    const note = raw as Record<string, unknown>;
    if (typeof note.id !== "string" || typeof note.teamNumber !== "string") continue;
    insertNote.run(
      note.id,
      note.teamNumber.toUpperCase(),
      String(note.authorName ?? "Team"),
      String(note.subject ?? ""),
      String(note.strengths ?? ""),
      String(note.concerns ?? ""),
      String(note.createdAt ?? new Date().toISOString()),
    );
  }

  const insertMatchNote = db.prepare(
    `INSERT OR IGNORE INTO match_notes (event_id, match_id, team_number, author_name, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const raw of readLegacyJson("competition-notes.json")) {
    const note = raw as Record<string, unknown>;
    if (typeof note.eventId !== "number" || typeof note.matchId !== "number" || typeof note.teamNumber !== "string") continue;
    insertMatchNote.run(
      note.eventId,
      note.matchId,
      note.teamNumber.toUpperCase(),
      String(note.authorName ?? "Team"),
      String(note.note ?? ""),
      String(note.createdAt ?? new Date().toISOString()),
    );
  }
}
