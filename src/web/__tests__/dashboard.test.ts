import { describe, it, expect } from "vitest";
import { createApp } from "../app.js";
import { SSEHub } from "../sse.js";
import type { DashboardRun } from "../routes/api.js";

describe("Dashboard route", () => {
  function makeApp(runs: DashboardRun[] = []) {
    return createApp({
      sseHub: new SSEHub(),
      onRefresh: async () => {},
      getState: () => ({ running: [], retryQueue: [], metrics: { tokensIn: 0, tokensOut: 0, runs: 0 } }),
      getRecentRuns: () => runs,
    });
  }

  it("renders Retries and Last Error column headers", async () => {
    const app = makeApp([
      {
        id: "run1",
        issueKey: "owner/repo#1",
        provider: "claude-code",
        status: "failed",
        startedAt: "2025-01-01T00:00:00Z",
        retryCount: 3,
        lastError: "Something went wrong",
      },
    ]);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Retries");
    expect(html).toContain("Last Error");
  });

  it("renders run data with retry count and error message", async () => {
    const app = makeApp([
      {
        id: "run2",
        issueKey: "org/proj#42",
        provider: "codex",
        status: "failed",
        startedAt: "2025-06-15T12:00:00Z",
        retryCount: 2,
        lastError: "Timeout exceeded",
      },
    ]);
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("org/proj#42");
    expect(html).toContain("2");
    expect(html).toContain("Timeout exceeded");
  });

  it("truncates long error messages to ~100 characters", async () => {
    const longError = "A".repeat(150);
    const app = makeApp([
      {
        id: "run3",
        issueKey: "o/r#1",
        provider: "claude-code",
        status: "failed",
        startedAt: "2025-01-01T00:00:00Z",
        retryCount: 1,
        lastError: longError,
      },
    ]);
    const res = await app.request("/");
    const html = await res.text();
    // Should contain truncated version (100 chars + "...")
    expect(html).toContain("A".repeat(100) + "...");
    // Should NOT contain the full 150-char string
    expect(html).not.toContain("A".repeat(150));
  });

  it("shows empty state when no runs exist", async () => {
    const app = makeApp([]);
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("No runs recorded yet");
  });
});
