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
    expect(run!.completedAt).toBeDefined();
  });

  it("completes a run with duration", () => {
    const startedAt = new Date().toISOString();
    repo.insert({
      id: "run3",
      issueKey: "owner/repo#3",
      provider: "claude-code",
      status: "running",
      startedAt,
      retryCount: 0,
    });
    const completedAt = new Date().toISOString();
    repo.completeRun("run3", "completed", completedAt, 12345);
    const run = repo.getById("run3");
    expect(run).toBeDefined();
    expect(run!.status).toBe("completed");
    expect(run!.completedAt).toBe(completedAt);
    expect(run!.durationMs).toBe(12345);
    expect(run!.error).toBeUndefined();
  });

  it("completes a failed run with duration and error", () => {
    repo.insert({
      id: "run4",
      issueKey: "owner/repo#4",
      provider: "codex",
      status: "running",
      startedAt: new Date().toISOString(),
      retryCount: 1,
    });
    const completedAt = new Date().toISOString();
    repo.completeRun("run4", "failed", completedAt, 5000, "timeout exceeded");
    const run = repo.getById("run4");
    expect(run).toBeDefined();
    expect(run!.status).toBe("failed");
    expect(run!.completedAt).toBe(completedAt);
    expect(run!.durationMs).toBe(5000);
    expect(run!.error).toBe("timeout exceeded");
  });

  it("getDurationStats returns correct statistics", () => {
    const now = new Date().toISOString();
    repo.insert({ id: "s1", issueKey: "o/r#1", provider: "claude-code", status: "running", startedAt: now, retryCount: 0 });
    repo.insert({ id: "s2", issueKey: "o/r#2", provider: "claude-code", status: "running", startedAt: now, retryCount: 0 });
    repo.insert({ id: "s3", issueKey: "o/r#3", provider: "claude-code", status: "running", startedAt: now, retryCount: 0 });

    repo.completeRun("s1", "completed", now, 10000);
    repo.completeRun("s2", "completed", now, 20000);
    repo.completeRun("s3", "completed", now, 30000);

    const stats = repo.getDurationStats();
    expect(stats.totalRuns).toBe(3);
    expect(stats.minDurationMs).toBe(10000);
    expect(stats.maxDurationMs).toBe(30000);
    expect(stats.avgDurationMs).toBe(20000);
  });

  it("getDurationStats returns zeros when no completed runs", () => {
    const stats = repo.getDurationStats();
    expect(stats.totalRuns).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
    expect(stats.minDurationMs).toBe(0);
    expect(stats.maxDurationMs).toBe(0);
  });

  it("getStatusCounts returns correct counts", () => {
    const now = new Date().toISOString();
    repo.insert({ id: "c1", issueKey: "o/r#1", provider: "claude-code", status: "running", startedAt: now, retryCount: 0 });
    repo.insert({ id: "c2", issueKey: "o/r#2", provider: "claude-code", status: "running", startedAt: now, retryCount: 0 });
    repo.insert({ id: "c3", issueKey: "o/r#3", provider: "claude-code", status: "running", startedAt: now, retryCount: 0 });
    repo.updateStatus("c1", "completed", now);
    repo.updateStatus("c2", "failed", now, "some error");

    const counts = repo.getStatusCounts();
    expect(counts.total).toBe(3);
    expect(counts.completed).toBe(1);
    expect(counts.failed).toBe(1);
    expect(counts.running).toBe(1);
  });

  it("getStatusCounts returns zeros when empty", () => {
    const counts = repo.getStatusCounts();
    expect(counts.total).toBe(0);
    expect(counts.completed).toBe(0);
    expect(counts.failed).toBe(0);
    expect(counts.running).toBe(0);
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
