import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";
import { RunsRepo } from "../runs.js";
import { RunEventsRepo } from "../run-events.js";

describe("RunEventsRepo", () => {
  let db: Database.Database;
  let events: RunEventsRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    const runs = new RunsRepo(db);
    runs.insert({ id: "run1", issueKey: "o/r#1", provider: "claude-code", status: "running", startedAt: new Date().toISOString(), retryCount: 0 });
    events = new RunEventsRepo(db);
  });
  afterEach(() => { db.close(); });

  it("inserts and retrieves events", () => {
    events.insert("run1", "text", { text: "hello" });
    events.insert("run1", "tool_call", { name: "grep", args: {} });
    const list = events.listByRun("run1");
    expect(list).toHaveLength(2);
    expect(list[0].type).toBe("text");
  });
});
