import { describe, it, expect } from "vitest";
import { createApp } from "../app.js";
import { SSEHub } from "../sse.js";

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
