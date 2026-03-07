import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";

describe("runMigrations", () => {
  let db: Database.Database;

  afterEach(() => {
    db?.close();
  });

  it("creates all required tables on a fresh database", () => {
    db = new Database(":memory:");
    runMigrations(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain("runs");
    expect(tables).toContain("run_events");
    expect(tables).toContain("planning_sessions");
    expect(tables).toContain("metrics");
    expect(tables).toContain("schema_version");
  });

  it("is idempotent", () => {
    db = new Database(":memory:");
    runMigrations(db);
    runMigrations(db);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all();
    // 4 domain tables + schema_version
    expect(tables.length).toBeGreaterThanOrEqual(5);
  });

  it("fresh database has completed_at and duration_ms columns", () => {
    db = new Database(":memory:");
    runMigrations(db);
    const columns = db
      .prepare("PRAGMA table_info(runs)")
      .all()
      .map((c: any) => c.name as string);
    expect(columns).toContain("completed_at");
    expect(columns).toContain("duration_ms");
  });

  it("adds completed_at and duration_ms to an existing database missing them", () => {
    db = new Database(":memory:");

    // Simulate an old schema without completed_at and duration_ms
    db.exec(`
      CREATE TABLE runs (
        id          TEXT PRIMARY KEY,
        issue_key   TEXT NOT NULL,
        provider    TEXT NOT NULL,
        model       TEXT,
        status      TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        error       TEXT,
        token_usage TEXT
      );
      CREATE TABLE run_events (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id  TEXT NOT NULL REFERENCES runs(id),
        type    TEXT NOT NULL,
        payload TEXT NOT NULL,
        ts      TEXT NOT NULL
      );
      CREATE TABLE planning_sessions (
        id         TEXT PRIMARY KEY,
        issue_key  TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        history    TEXT NOT NULL
      );
      CREATE TABLE metrics (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id      TEXT REFERENCES runs(id),
        provider    TEXT NOT NULL,
        model       TEXT,
        tokens_in   INTEGER,
        tokens_out  INTEGER,
        duration_ms INTEGER,
        ts          TEXT NOT NULL
      );
    `);

    // Verify columns are missing before migration
    const before = db
      .prepare("PRAGMA table_info(runs)")
      .all()
      .map((c: any) => c.name as string);
    expect(before).not.toContain("completed_at");
    expect(before).not.toContain("duration_ms");

    // Run migrations — should add the missing columns
    runMigrations(db);

    const after = db
      .prepare("PRAGMA table_info(runs)")
      .all()
      .map((c: any) => c.name as string);
    expect(after).toContain("completed_at");
    expect(after).toContain("duration_ms");
  });

  it("records applied migrations in schema_version", () => {
    db = new Database(":memory:");
    runMigrations(db);
    const versions = db
      .prepare("SELECT version, description FROM schema_version ORDER BY version")
      .all() as { version: number; description: string }[];
    expect(versions.length).toBeGreaterThanOrEqual(1);
    expect(versions[0].version).toBe(1);
    expect(versions[0].description).toBe(
      "Add completed_at and duration_ms to runs",
    );
  });

  it("does not re-apply already applied migrations", () => {
    db = new Database(":memory:");
    runMigrations(db);
    runMigrations(db);
    const rows = db
      .prepare("SELECT COUNT(*) as cnt FROM schema_version WHERE version = 1")
      .get() as { cnt: number };
    expect(rows.cnt).toBe(1);
  });

  it("preserves existing data when adding columns", () => {
    db = new Database(":memory:");

    // Old schema without new columns
    db.exec(`
      CREATE TABLE runs (
        id          TEXT PRIMARY KEY,
        issue_key   TEXT NOT NULL,
        provider    TEXT NOT NULL,
        model       TEXT,
        status      TEXT NOT NULL,
        started_at  TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        error       TEXT,
        token_usage TEXT
      );
      CREATE TABLE run_events (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id  TEXT NOT NULL REFERENCES runs(id),
        type    TEXT NOT NULL,
        payload TEXT NOT NULL,
        ts      TEXT NOT NULL
      );
      CREATE TABLE planning_sessions (
        id         TEXT PRIMARY KEY,
        issue_key  TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        history    TEXT NOT NULL
      );
      CREATE TABLE metrics (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id      TEXT REFERENCES runs(id),
        provider    TEXT NOT NULL,
        model       TEXT,
        tokens_in   INTEGER,
        tokens_out  INTEGER,
        duration_ms INTEGER,
        ts          TEXT NOT NULL
      );
    `);

    // Insert a row with the old schema
    db.prepare(
      "INSERT INTO runs (id, issue_key, provider, status, started_at, retry_count) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("run-1", "issue-1", "anthropic", "completed", "2025-01-01T00:00:00Z", 0);

    runMigrations(db);

    // Existing row should still be there with NULL for new columns
    const row = db.prepare("SELECT * FROM runs WHERE id = ?").get("run-1") as any;
    expect(row.id).toBe("run-1");
    expect(row.issue_key).toBe("issue-1");
    expect(row.completed_at).toBeNull();
    expect(row.duration_ms).toBeNull();
  });

  it("migration 3 adds repo and repo_context to planning_sessions", () => {
    db = new Database(":memory:");
    runMigrations(db);
    const columns = db
      .prepare("PRAGMA table_info(planning_sessions)")
      .all()
      .map((c: any) => c.name as string);
    expect(columns).toContain("repo");
    expect(columns).toContain("repo_context");
  });
});
