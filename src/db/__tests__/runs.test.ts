import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";
import { RunsRepo } from "../runs.js";

describe("RunsRepo", () => {
  let db: Database.Database;
  let repo: RunsRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new RunsRepo(db);
  });
  afterEach(() => { db.close(); });

  it("inserts and retrieves a run", () => {
    repo.insert({
      id: "run1",
      issueKey: "owner/repo#1",
      provider: "claude-code",
      status: "running",
      startedAt: new Date().toISOString(),
      retryCount: 0,
    });
    const run = repo.getById("run1");
    expect(run).toBeDefined();
    expect(run!.issueKey).toBe("owner/repo#1");
  });

  it("updates run status", () => {
    repo.insert({
      id: "run2",
      issueKey: "owner/repo#2",
      provider: "codex",
      status: "running",
      startedAt: new Date().toISOString(),
      retryCount: 0,
    });
    repo.updateStatus("run2", "completed", new Date().toISOString());
    const run = repo.getById("run2");
    expect(run!.status).toBe("completed");
    expect(run!.finishedAt).toBeDefined();
  });

  it("lists runs by issue key", () => {
    const now = new Date().toISOString();
    repo.insert({ id: "r1", issueKey: "o/r#1", provider: "claude-code", status: "completed", startedAt: now, retryCount: 0 });
    repo.insert({ id: "r2", issueKey: "o/r#1", provider: "claude-code", status: "failed", startedAt: now, retryCount: 1 });
    repo.insert({ id: "r3", issueKey: "o/r#2", provider: "codex", status: "running", startedAt: now, retryCount: 0 });
    const runs = repo.listByIssue("o/r#1");
    expect(runs).toHaveLength(2);
  });
});
