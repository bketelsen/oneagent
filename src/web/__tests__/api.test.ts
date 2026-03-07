import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "../app.js";
import { SSEHub } from "../sse.js";
import { runMigrations } from "../../db/migrations.js";
import { RunsRepo } from "../../db/runs.js";

describe("API routes", () => {
  it("POST /api/v1/refresh returns 200", async () => {
    const app = createApp({
      sseHub: new SSEHub(),
      onRefresh: async () => {},
      getState: () => ({ running: [], retryQueue: [], metrics: { tokensIn: 0, tokensOut: 0, runs: 0 } }),
    });
    const res = await app.request("/api/v1/refresh", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("GET /api/v1/status returns state", async () => {
    const app = createApp({
      sseHub: new SSEHub(),
      onRefresh: async () => {},
      getState: () => ({
        running: [{ runId: "r1", issueKey: "o/r#1", provider: "claude-code" }],
        retryQueue: [],
        metrics: { tokensIn: 100, tokensOut: 50, runs: 1 },
      }),
    });
    const res = await app.request("/api/v1/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.running).toHaveLength(1);
  });

  it("GET /api/v1/metrics returns aggregated stats", async () => {
    const app = createApp({
      sseHub: new SSEHub(),
      onRefresh: async () => {},
      getState: () => ({ running: [], retryQueue: [], metrics: { tokensIn: 0, tokensOut: 0, runs: 0 } }),
      getDurationStats: () => ({
        avgDurationMs: 15000,
        minDurationMs: 10000,
        maxDurationMs: 20000,
        totalRuns: 2,
      }),
      getStatusCounts: () => ({
        total: 5,
        completed: 3,
        failed: 1,
        running: 1,
      }),
      getTotalTokens: () => ({
        tokensIn: 500,
        tokensOut: 250,
        runs: 5,
      }),
    });
    const res = await app.request("/api/v1/metrics");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duration.avgDurationMs).toBe(15000);
    expect(body.duration.minDurationMs).toBe(10000);
    expect(body.duration.maxDurationMs).toBe(20000);
    expect(body.duration.totalRuns).toBe(2);
    expect(body.tokens.tokensIn).toBe(500);
    expect(body.tokens.tokensOut).toBe(250);
    expect(body.runs.total).toBe(5);
    expect(body.runs.completed).toBe(3);
    expect(body.runs.failed).toBe(1);
    expect(body.runs.running).toBe(1);
  });

  it("GET /api/v1/metrics returns zeros when no callbacks provided", async () => {
    const app = createApp({
      sseHub: new SSEHub(),
      onRefresh: async () => {},
      getState: () => ({ running: [], retryQueue: [], metrics: { tokensIn: 0, tokensOut: 0, runs: 0 } }),
    });
    const res = await app.request("/api/v1/metrics");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duration).toEqual({
      avgDurationMs: 0,
      minDurationMs: 0,
      maxDurationMs: 0,
      totalRuns: 0,
    });
    expect(body.tokens).toEqual({
      tokensIn: 0,
      tokensOut: 0,
      runs: 0,
    });
    expect(body.runs).toEqual({
      total: 0,
      completed: 0,
      failed: 0,
      running: 0,
    });
  });
});

describe("GET /api/v1/runs/:id", () => {
  let db: Database.Database;
  let runsRepo: RunsRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    runsRepo = new RunsRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  function makeApp() {
    return createApp({
      sseHub: new SSEHub(),
      onRefresh: async () => {},
      getState: () => ({
        running: [],
        retryQueue: [],
        metrics: { tokensIn: 0, tokensOut: 0, runs: 0 },
      }),
      runsRepo,
    });
  }

  it("returns 200 with run JSON for existing run", async () => {
    const now = new Date().toISOString();
    runsRepo.insert({
      id: "run-abc",
      issueKey: "owner/repo#42",
      provider: "claude-code",
      model: "claude-4",
      status: "running",
      startedAt: now,
      retryCount: 0,
    });

    const app = makeApp();
    const res = await app.request("/api/v1/runs/run-abc");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.id).toBe("run-abc");
    expect(body.issueKey).toBe("owner/repo#42");
    expect(body.provider).toBe("claude-code");
    expect(body.model).toBe("claude-4");
    expect(body.status).toBe("running");
    expect(body.startedAt).toBe(now);
    expect(body.retryCount).toBe(0);
  });

  it("returns 404 JSON for unknown run ID", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/runs/nonexistent");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe("Run not found");
  });

  it("returns completed run with duration and error fields", async () => {
    const now = new Date().toISOString();
    runsRepo.insert({
      id: "run-fail",
      issueKey: "owner/repo#5",
      provider: "claude-code",
      status: "running",
      startedAt: now,
      retryCount: 1,
    });
    runsRepo.completeRun("run-fail", "failed", now, 5000, "timeout exceeded");

    const app = makeApp();
    const res = await app.request("/api/v1/runs/run-fail");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.durationMs).toBe(5000);
    expect(body.error).toBe("timeout exceeded");
    expect(body.completedAt).toBe(now);
  });
});
