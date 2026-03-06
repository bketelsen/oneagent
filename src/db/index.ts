import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export function createDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

export { runMigrations } from "./migrations.js";
