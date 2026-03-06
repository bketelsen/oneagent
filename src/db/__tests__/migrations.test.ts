import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";

describe("runMigrations", () => {
  let db: Database.Database;

  afterEach(() => { db?.close(); });

  it("creates all required tables", () => {
    db = new Database(":memory:");
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain("runs");
    expect(tables).toContain("run_events");
    expect(tables).toContain("planning_sessions");
    expect(tables).toContain("metrics");
  });

  it("is idempotent", () => {
    db = new Database(":memory:");
    runMigrations(db);
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all();
    expect(tables.length).toBeGreaterThanOrEqual(4);
  });
});
