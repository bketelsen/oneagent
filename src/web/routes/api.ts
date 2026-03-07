import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEHub } from "../sse.js";
import type { DurationStats, StatusCounts } from "../../db/runs.js";

export interface DashboardRun {
  id: string;
  issueKey: string;
  provider: string;
  status: string;
  startedAt: string;
  retryCount: number;
  lastError?: string;
}

export interface AppContext {
  sseHub: SSEHub;
  onRefresh: () => Promise<void>;
  getState: () => {
    running: Array<{ runId: string; issueKey: string; provider: string }>;
    retryQueue: string[];
    metrics: { tokensIn: number; tokensOut: number; runs: number };
  };
  getRecentRuns?: () => DashboardRun[];
  getDurationStats?: () => DurationStats;
  getStatusCounts?: () => StatusCounts;
  getTotalTokens?: () => { tokensIn: number; tokensOut: number; runs: number };
}

export function apiRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.post("/refresh", async (c) => {
    await ctx.onRefresh();
    return c.json({ ok: true });
  });

  api.get("/status", (c) => {
    return c.json(ctx.getState());
  });

  api.get("/events", (c) => {
    return streamSSE(c, async (stream) => {
      const unsub = ctx.sseHub.subscribe((event, data) => {
        stream.writeSSE({ event, data: JSON.stringify(data) });
      });
      await new Promise((resolve) => {
        c.req.raw.signal.addEventListener("abort", resolve);
      });
      unsub();
    });
  });

  api.get("/metrics", (c) => {
    const duration = ctx.getDurationStats?.() ?? {
      avgDurationMs: 0,
      minDurationMs: 0,
      maxDurationMs: 0,
      totalRuns: 0,
    };
    const tokens = ctx.getTotalTokens?.() ?? {
      tokensIn: 0,
      tokensOut: 0,
      runs: 0,
    };
    const runs = ctx.getStatusCounts?.() ?? {
      total: 0,
      completed: 0,
      failed: 0,
      running: 0,
    };
    return c.json({ duration, tokens, runs });
  });

  return api;
}
