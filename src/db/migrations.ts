import type Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";

const MIGRATIONS: string[] = [
  // Migration 1: Add completed_at and duration_ms to runs table
  `ALTER TABLE runs ADD COLUMN completed_at TEXT;`,
  `ALTER TABLE runs ADD COLUMN duration_ms INTEGER;`,
];

export function runMigrations(db: Database.Database): void {
  db.exec(SCHEMA_SQL);

  // Apply incremental migrations for existing databases
  // For new databases the columns already exist from SCHEMA_SQL,
  // so we ignore "duplicate column" errors.
  for (const sql of MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (err: any) {
      // Ignore errors from columns that already exist
      if (!err.message?.includes("duplicate column")) {
        throw err;
      }
    }
  }
}
