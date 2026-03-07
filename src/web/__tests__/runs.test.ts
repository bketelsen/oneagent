import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "../app.js";
import { SSEHub } from "../sse.js";
import { runMigrations } from "../../db/migrations.js";
import { RunsRepo } from "../../db/runs.js";
import { RunEventsRepo } from "../../db/run-events.js";

describe("GET /runs/:id", () => {
  let db: Database.Database;
  let runsRepo: RunsRepo;
  let eventsRepo: RunEventsRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    runsRepo = new RunsRepo(db);
    eventsRepo = new RunEventsRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  function makeApp() {
    return createApp({
      app: {
        sseHub: new SSEHub(),
        onRefresh: async () => {},
        getState: () => ({
          running: [],
          retryQueue: [],
          metrics: { tokensIn: 0, tokensOut: 0, runs: 0 },
        }),
      },
      runs: { runsRepo, eventsRepo },
    });
  }

  it("returns 200 with run details and events", async () => {
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
    eventsRepo.insert("run-abc", "tool_use", { tool: "bash", input: "ls" });
    eventsRepo.insert("run-abc", "message", { text: "hello" });

    const app = makeApp();
    const res = await app.request("/runs/run-abc");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('href="https://github.com/owner/repo/issues/42"');
    expect(html).toContain("#42");
    expect(html).toContain("claude-code");
    expect(html).toContain("running");
    expect(html).toContain("tool_use");
    expect(html).toContain("message");
    expect(html).toContain("run-abc");
  });

  it("renders issue number as a clickable GitHub link", async () => {
    const now = new Date().toISOString();
    runsRepo.insert({
      id: "run-link",
      issueKey: "bketelsen/oneagent#79",
      provider: "claude-code",
      status: "running",
      startedAt: now,
      retryCount: 0,
    });

    const app = makeApp();
    const res = await app.request("/runs/run-link");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain('href="https://github.com/bketelsen/oneagent/issues/79"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("#79");
  });

  it("returns 404 for unknown run ID", async () => {
    const app = makeApp();
    const res = await app.request("/runs/nonexistent");
    expect(res.status).toBe(404);

    const html = await res.text();
    expect(html).toContain("Run Not Found");
    expect(html).toContain("nonexistent");
  });

  it("renders correctly when run has no events", async () => {
    const now = new Date().toISOString();
    runsRepo.insert({
      id: "run-empty",
      issueKey: "owner/repo#1",
      provider: "codex",
      status: "done",
      startedAt: now,
      retryCount: 0,
    });

    const app = makeApp();
    const res = await app.request("/runs/run-empty");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("No events recorded");
    expect(html).toContain("Events (0)");
  });

  it("shows error details for failed runs", async () => {
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
    const res = await app.request("/runs/run-fail");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("failed");
    expect(html).toContain("timeout exceeded");
  });
});
