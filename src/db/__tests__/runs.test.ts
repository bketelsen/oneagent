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

  it("records completed_at and duration_ms when completing a run", () => {
    const startedAt = new Date("2026-03-06T10:00:00.000Z").toISOString();
    repo.insert({
      id: "run-dur1",
      issueKey: "o/r#5",
      provider: "claude-code",
      status: "running",
      startedAt,
      retryCount: 0,
    });

    const completedAt = new Date("2026-03-06T10:05:30.000Z").toISOString();
    repo.completeRun("run-dur1", "completed", completedAt);

    const run = repo.getById("run-dur1");
    expect(run).toBeDefined();
    expect(run!.status).toBe("completed");
    expect(run!.completedAt).toBe(completedAt);
    expect(run!.durationMs).toBe(330000); // 5 min 30 sec = 330000 ms
  });

  it("records duration_ms when completing a run with error", () => {
    const startedAt = new Date("2026-03-06T12:00:00.000Z").toISOString();
    repo.insert({
      id: "run-dur2",
      issueKey: "o/r#6",
      provider: "codex",
      status: "running",
      startedAt,
      retryCount: 0,
    });

    const completedAt = new Date("2026-03-06T12:01:00.000Z").toISOString();
    repo.completeRun("run-dur2", "failed", completedAt, "something broke");

    const run = repo.getById("run-dur2");
    expect(run!.status).toBe("failed");
    expect(run!.durationMs).toBe(60000);
    expect(run!.error).toBe("something broke");
  });

  it("returns duration stats for recent runs", () => {
    const base = new Date("2026-03-06T08:00:00.000Z");

    // Insert 3 completed runs with different durations
    for (let i = 0; i < 3; i++) {
      const startedAt = new Date(base.getTime() + i * 3600000).toISOString();
      const durationMs = (i + 1) * 60000; // 60s, 120s, 180s
      const completedAt = new Date(base.getTime() + i * 3600000 + durationMs).toISOString();
      repo.insert({
        id: `stat-${i}`,
        issueKey: "o/r#7",
        provider: "claude-code",
        status: "running",
        startedAt,
        retryCount: 0,
      });
      repo.completeRun(`stat-${i}`, "completed", completedAt);
    }

    const stats = repo.getDurationStats(10);
    expect(stats).toBeDefined();
    expect(stats!.count).toBe(3);
    expect(stats!.minMs).toBe(60000);
    expect(stats!.maxMs).toBe(180000);
    expect(stats!.avgMs).toBe(120000);
  });

  it("returns undefined duration stats when no completed runs exist", () => {
    const stats = repo.getDurationStats(10);
    expect(stats).toBeUndefined();
  });
});
