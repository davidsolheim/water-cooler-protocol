import { Database } from "bun:sqlite";

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA busy_timeout=5000;");
  db.exec("PRAGMA foreign_keys=ON;");
  migrate(db);
  return db;
}

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      branch TEXT NOT NULL DEFAULT 'dev',
      arch TEXT NOT NULL DEFAULT '',
      ttl_sec INTEGER NOT NULL DEFAULT 60,
      created_at TEXT NOT NULL
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
      pid INTEGER
    );
  `);
}
