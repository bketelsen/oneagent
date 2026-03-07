import type Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

/**
 * Incremental migrations applied after the initial schema.
 * Each migration runs once and is tracked via the schema_version table.
 * Migrations MUST be idempotent — they guard with column-existence checks.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Add completed_at and duration_ms to runs",
    up(db) {
      const columns = db
        .prepare("PRAGMA table_info(runs)")
        .all()
        .map((c: any) => c.name as string);

      if (!columns.includes("completed_at")) {
        db.exec("ALTER TABLE runs ADD COLUMN completed_at TEXT");
      }
      if (!columns.includes("duration_ms")) {
        db.exec("ALTER TABLE runs ADD COLUMN duration_ms INTEGER");
      }
    },
  },
];

function ensureSchemaVersionTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version     INTEGER PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function getCurrentVersion(db: Database.Database): number {
  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_version")
    .get() as { v: number };
  return row.v;
}

export function runMigrations(db: Database.Database): void {
  // 1. Create tables that don't exist yet (initial schema)
  db.exec(SCHEMA_SQL);

  // 2. Set up version tracking
  ensureSchemaVersionTable(db);

  // 3. Apply any pending incremental migrations
  const current = getCurrentVersion(db);

  const pending = MIGRATIONS.filter((m) => m.version > current);
  for (const migration of pending) {
    const applyMigration = db.transaction(() => {
      migration.up(db);
      db.prepare(
        "INSERT INTO schema_version (version, description) VALUES (?, ?)",
      ).run(migration.version, migration.description);
    });
    applyMigration();
  }
}
