import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApp } from "../app.js";
import { SSEHub } from "../sse.js";

describe("Live dashboard features", () => {
  function makeApp(opts: {
    running?: Array<{
      runId: string;
      issueKey: string;
      provider: string;
      currentAgent?: string;
      lastActivityDescription?: string;
      toolCallCount?: number;
      startedAt?: string;
    }>;
    runsRepo?: any;
    eventsRepo?: any;
  } = {}) {
    const defaultRunsRepo = {
      getById: vi.fn().mockReturnValue(null),
      listAll: vi.fn().mockReturnValue([]),
      listByIssue: vi.fn().mockReturnValue([]),
      ...opts.runsRepo,
    };
    const defaultEventsRepo = {
      listByRun: vi.fn().mockReturnValue([]),
      getLastError: vi.fn().mockReturnValue(null),
      ...opts.eventsRepo,
    };

    return createApp({
      app: {
        sseHub: new SSEHub(),
        onRefresh: async () => {},
        getState: () => ({
          running: opts.running ?? [],
          retryQueue: [],
          metrics: { tokensIn: 0, tokensOut: 0, runs: 0 },
        }),
        getRecentRuns: () => [],
      },
      runs: {
        runsRepo: defaultRunsRepo,
        eventsRepo: defaultEventsRepo,
      },
      logger: undefined as any,
    });
  }

  describe("Dashboard summary cards", () => {
    it("shows current agent badge for running agents", async () => {
      const app = makeApp({
        running: [
          {
            runId: "r1",
            issueKey: "o/r#1",
            provider: "claude-code",
            currentAgent: "debugger",
            lastActivityDescription: "Called Bash: npm test",
            toolCallCount: 5,
            startedAt: new Date().toISOString(),
          },
        ],
      });
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("debugger");
      expect(html).toContain("o/r#1");
      expect(html).toContain("5 tool calls");
      expect(html).toContain("Called Bash: npm test");
    });

    it("shows cancel button on running agent cards", async () => {
      const app = makeApp({
        running: [
          {
            runId: "r-cancel",
            issueKey: "o/r#99",
            provider: "claude-code",
            currentAgent: "coder",
            startedAt: new Date().toISOString(),
          },
        ],
      });
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("cancel-run-btn");
      expect(html).toContain('data-cancel-run="r-cancel"');
      expect(html).toContain("/api/v1/runs/r-cancel/cancel");
    });

    it("shows default values when optional fields are missing", async () => {
      const app = makeApp({
        running: [
          {
            runId: "r2",
            issueKey: "o/r#2",
            provider: "claude-code",
          },
        ],
      });
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("coder");
      expect(html).toContain("Starting...");
      expect(html).toContain("0 tool calls");
    });

    it("links running agents to /runs/:id/live", async () => {
      const app = makeApp({
        running: [
          {
            runId: "run-abc",
            issueKey: "o/r#3",
            provider: "claude-code",
            currentAgent: "coder",
            startedAt: new Date().toISOString(),
          },
        ],
      });
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("/runs/run-abc/live");
    });

    it("shows elapsed timer with data-started attribute", async () => {
      const started = "2026-03-06T10:00:00Z";
      const app = makeApp({
        running: [
          {
            runId: "r3",
            issueKey: "o/r#4",
            provider: "claude-code",
            startedAt: started,
          },
        ],
      });
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain('data-started="2026-03-06T10:00:00Z"');
      expect(html).toContain("elapsed-timer");
    });
  });

  describe("Live detail page", () => {
    it("returns 404 for unknown run ID", async () => {
      const app = makeApp();
      const res = await app.request("/runs/nonexistent/live");
      expect(res.status).toBe(404);
      const html = await res.text();
      expect(html).toContain("Run Not Found");
    });

    it("renders live page for existing run", async () => {
      const app = makeApp({
        runsRepo: {
          getById: vi.fn().mockReturnValue({
            id: "run-123",
            issueKey: "owner/repo#42",
            provider: "claude-code",
            status: "running",
            startedAt: "2026-03-06T12:00:00Z",
            retryCount: 0,
          }),
          listAll: vi.fn().mockReturnValue([]),
          listByIssue: vi.fn().mockReturnValue([]),
        },
      });
      const res = await app.request("/runs/run-123/live");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("owner/repo#42");
      expect(html).toContain("Live Run");
      expect(html).toContain("event-feed");
      expect(html).toContain("pause-btn");
      expect(html).toContain("Pause");
      expect(html).toContain("Tool Calls");
      expect(html).toContain("Current Agent");
      expect(html).toContain("Elapsed");
    });

    it("includes SSE event source connection script", async () => {
      const app = makeApp({
        runsRepo: {
          getById: vi.fn().mockReturnValue({
            id: "run-456",
            issueKey: "o/r#10",
            provider: "claude-code",
            status: "running",
            startedAt: "2026-03-06T12:00:00Z",
            retryCount: 0,
          }),
          listAll: vi.fn().mockReturnValue([]),
          listByIssue: vi.fn().mockReturnValue([]),
        },
      });
      const res = await app.request("/runs/run-456/live");
      const html = await res.text();
      expect(html).toContain("EventSource");
      expect(html).toContain("/api/v1/events");
      expect(html).toContain("run-456");
    });

    it("uses addEventListener for named SSE events instead of onmessage", async () => {
      const app = makeApp({
        runsRepo: {
          getById: vi.fn().mockReturnValue({
            id: "run-sse",
            issueKey: "o/r#99",
            provider: "claude-code",
            status: "running",
            startedAt: "2026-03-06T12:00:00Z",
            retryCount: 0,
          }),
          listAll: vi.fn().mockReturnValue([]),
          listByIssue: vi.fn().mockReturnValue([]),
        },
      });
      const res = await app.request("/runs/run-sse/live");
      const html = await res.text();

      // Should NOT use es.onmessage (only catches unnamed events)
      expect(html).not.toContain("es.onmessage");

      // Should use addEventListener for each named event type
      expect(html).toContain("addEventListener");
      const namedEvents = [
        "agent:text",
        "agent:tool_call",
        "agent:tool_result",
        "agent:handoff",
        "agent:error",
        "agent:done",
        "agent:started",
        "agent:completed",
        "agent:failed",
      ];
      for (const eventType of namedEvents) {
        expect(html).toContain(eventType);
      }
    });

    it("renders cancel button on live page", async () => {
      const app = makeApp({
        runsRepo: {
          getById: vi.fn().mockReturnValue({
            id: "run-cancel",
            issueKey: "owner/repo#50",
            provider: "claude-code",
            status: "running",
            startedAt: "2026-03-06T12:00:00Z",
            retryCount: 0,
          }),
          listAll: vi.fn().mockReturnValue([]),
          listByIssue: vi.fn().mockReturnValue([]),
        },
      });
      const res = await app.request("/runs/run-cancel/live");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("cancel-btn");
      expect(html).toContain("Cancel Run");
      expect(html).toContain("/api/v1/runs/");
      expect(html).toContain("/cancel");
    });

    it("includes auto-scroll toggle functionality", async () => {
      const app = makeApp({
        runsRepo: {
          getById: vi.fn().mockReturnValue({
            id: "run-789",
            issueKey: "o/r#20",
            provider: "claude-code",
            status: "running",
            startedAt: "2026-03-06T12:00:00Z",
            retryCount: 0,
          }),
          listAll: vi.fn().mockReturnValue([]),
          listByIssue: vi.fn().mockReturnValue([]),
        },
      });
      const res = await app.request("/runs/run-789/live");
      const html = await res.text();
      expect(html).toContain("autoScroll");
      expect(html).toContain("Resume");
    });
  });

  describe("Dashboard links", () => {
    it("links running runs in recent table to live page", async () => {
      const app = createApp({
        app: {
          sseHub: new SSEHub(),
          onRefresh: async () => {},
          getState: () => ({
            running: [],
            retryQueue: [],
            metrics: { tokensIn: 0, tokensOut: 0, runs: 0 },
          }),
          getRecentRuns: () => [
            {
              id: "run-live",
              issueKey: "o/r#5",
              provider: "claude-code",
              status: "running",
              startedAt: "2026-03-06T12:00:00Z",
              retryCount: 0,
            },
          ],
        },
        logger: undefined as any,
      });
      const res = await app.request("/");
      const html = await res.text();
      expect(html).toContain("/runs/run-live/live");
    });

    it("links completed runs in recent table to static page", async () => {
      const app = createApp({
        app: {
          sseHub: new SSEHub(),
          onRefresh: async () => {},
          getState: () => ({
            running: [],
            retryQueue: [],
            metrics: { tokensIn: 0, tokensOut: 0, runs: 0 },
          }),
          getRecentRuns: () => [
            {
              id: "run-done",
              issueKey: "o/r#6",
              provider: "claude-code",
              status: "completed",
              startedAt: "2026-03-06T12:00:00Z",
              retryCount: 0,
            },
          ],
        },
        logger: undefined as any,
      });
      const res = await app.request("/");
      const html = await res.text();
      // Should link to static page, not live
      expect(html).toContain('href="/runs/run-done"');
      expect(html).not.toContain("/runs/run-done/live");
    });
  });
});
