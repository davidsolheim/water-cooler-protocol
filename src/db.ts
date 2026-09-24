import { Database } from "bun:sqlite";

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA busy_timeout=5000;");
  db.exec("PRAGMA foreign_keys=ON;");
  migrate(db);
  return db;
}

function ensureColumn(db: Database, table: string, column: string, alter: string): void {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((col) => col.name === column)) {
    db.exec(alter);
  }
}

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      branch TEXT NOT NULL DEFAULT 'dev',
      arch TEXT NOT NULL DEFAULT '',
      ttl_sec INTEGER NOT NULL DEFAULT 60,
      created_at TEXT NOT NULL,
      snap_at TEXT
    );

    CREATE TABLE IF NOT EXISTS live (
      agent_id TEXT NOT NULL PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      doing TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '',
      from_agent TEXT,
      leased_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      pid INTEGER,
      test_path TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS existed (
      path TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS actor (
      agent_id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      named_at TEXT NOT NULL,
      pid INTEGER
    );
  `);
  ensureColumn(db, "run", "snap_at", "ALTER TABLE run ADD COLUMN snap_at TEXT");
  ensureColumn(
    db,
    "live",
    "test_path",
    "ALTER TABLE live ADD COLUMN test_path TEXT NOT NULL DEFAULT ''",
  );
}
