import type Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";

export function runMigrations(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
}
