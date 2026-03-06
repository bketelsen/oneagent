import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";
import { MetricsRepo } from "../metrics.js";

describe("MetricsRepo", () => {
  let db: Database.Database;
  let metrics: MetricsRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    metrics = new MetricsRepo(db);
  });
  afterEach(() => { db.close(); });

  it("records and aggregates token usage", () => {
    metrics.record({ provider: "claude-code", tokensIn: 100, tokensOut: 50, durationMs: 5000 });
    metrics.record({ provider: "claude-code", tokensIn: 200, tokensOut: 100, durationMs: 3000 });
    const totals = metrics.totals();
    expect(totals.tokensIn).toBe(300);
    expect(totals.tokensOut).toBe(150);
  });
});
