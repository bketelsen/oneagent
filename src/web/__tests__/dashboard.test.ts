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

  describe("Run Timeline", () => {
    it("shows empty state when no runs exist", async () => {
      const app = makeApp([]);
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("Run Timeline");
      expect(html).toContain("No runs to display");
    });

    it("renders timeline bars for runs with correct colors", async () => {
      const app = makeApp([
        {
          id: "t1",
          issueKey: "owner/repo#10",
          provider: "claude-code",
          status: "completed",
          startedAt: new Date(Date.now() - 300000).toISOString(),
          durationMs: 5000,
          retryCount: 0,
        },
        {
          id: "t2",
          issueKey: "owner/repo#11",
          provider: "claude-code",
          status: "failed",
          startedAt: new Date(Date.now() - 600000).toISOString(),
          durationMs: 3000,
          retryCount: 1,
        },
        {
          id: "t3",
          issueKey: "owner/repo#12",
          provider: "claude-code",
          status: "running",
          startedAt: new Date(Date.now() - 60000).toISOString(),
          durationMs: 1000,
          retryCount: 0,
        },
      ]);
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("Run Timeline");
      expect(html).toContain('data-testid="run-timeline"');
      // Green for completed
      expect(html).toContain("background-color:#22c55e");
      // Red for failed
      expect(html).toContain("background-color:#ef4444");
      // Yellow for running
      expect(html).toContain("background-color:#eab308");
    });

    it("renders bars as links to run detail pages", async () => {
      const app = makeApp([
        {
          id: "link1",
          issueKey: "owner/repo#5",
          provider: "claude-code",
          status: "completed",
          startedAt: new Date(Date.now() - 120000).toISOString(),
          durationMs: 2000,
          retryCount: 0,
        },
      ]);
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain('href="/runs/link1"');
    });

    it("shows issue key on hover via title attribute", async () => {
      const app = makeApp([
        {
          id: "hover1",
          issueKey: "org/proj#99",
          provider: "claude-code",
          status: "completed",
          startedAt: new Date(Date.now() - 120000).toISOString(),
          durationMs: 4000,
          retryCount: 0,
        },
      ]);
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain('title="org/proj#99"');
    });

    it("sets bar width proportional to duration", async () => {
      const app = makeApp([
        {
          id: "w1",
          issueKey: "o/r#1",
          provider: "claude-code",
          status: "completed",
          startedAt: new Date(Date.now() - 300000).toISOString(),
          durationMs: 10000,
          retryCount: 0,
        },
        {
          id: "w2",
          issueKey: "o/r#2",
          provider: "claude-code",
          status: "completed",
          startedAt: new Date(Date.now() - 600000).toISOString(),
          durationMs: 5000,
          retryCount: 0,
        },
      ]);
      const res = await app.request("/");
      const html = await res.text();
      // Longest run should be 100% width
      expect(html).toContain("width:100%");
      // Half-duration run should be 50% width
      expect(html).toContain("width:50%");
    });

    it("limits timeline to 20 runs", async () => {
      const runs: DashboardRun[] = [];
      for (let i = 0; i < 25; i++) {
        runs.push({
          id: `bulk${i}`,
          issueKey: `o/r#${i}`,
          provider: "claude-code",
          status: "completed",
          startedAt: new Date(Date.now() - i * 60000).toISOString(),
          durationMs: 1000,
          retryCount: 0,
        });
      }
      const app = makeApp(runs);
      const res = await app.request("/");
      const html = await res.text();
      // Extract timeline section only
      const timelineStart = html.indexOf('data-testid="run-timeline"');
      const timelineEnd = html.indexOf("Running Agents");
      const timelineHtml = html.slice(timelineStart, timelineEnd);
      // Should contain the first 20 runs in the timeline
      expect(timelineHtml).toContain('title="o/r#0"');
      expect(timelineHtml).toContain('title="o/r#19"');
      // Should NOT contain runs beyond the 20th in the timeline
      expect(timelineHtml).not.toContain('title="o/r#20"');
    });

    it("renders a color legend below the timeline bars", async () => {
      const app = makeApp([
        {
          id: "leg1",
          issueKey: "o/r#1",
          provider: "claude-code",
          status: "completed",
          startedAt: new Date(Date.now() - 60000).toISOString(),
          durationMs: 1000,
          retryCount: 0,
        },
      ]);
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain('data-testid="run-timeline-legend"');
      expect(html).toContain("completed");
      expect(html).toContain("failed");
      expect(html).toContain("running");
      // Verify the legend uses the correct colors
      expect(html).toContain("color:#22c55e");
      expect(html).toContain("color:#ef4444");
      expect(html).toContain("color:#eab308");
    });

    it("does not render legend when there are no runs", async () => {
      const app = makeApp([]);
      const res = await app.request("/");
      const html = await res.text();
      expect(html).not.toContain('data-testid="run-timeline-legend"');
    });

    it("shows relative time labels", async () => {
      const app = makeApp([
        {
          id: "time1",
          issueKey: "o/r#1",
          provider: "claude-code",
          status: "completed",
          startedAt: new Date(Date.now() - 5 * 60000).toISOString(),
          durationMs: 2000,
          retryCount: 0,
        },
      ]);
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("5m ago");
    });
  });
});
