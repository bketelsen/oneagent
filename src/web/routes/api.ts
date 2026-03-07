import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEHub } from "../sse.js";
import type { DurationStats, StatusCounts, RunsRepo } from "../../db/runs.js";
import { getCostEstimate } from "../../utils/cost.js";

export interface DashboardRun {
  id: string;
  issueKey: string;
  provider: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
  lastError?: string;
}

export interface AppContext {
  sseHub: SSEHub;
  onRefresh: () => Promise<void>;
  getState: () => {
    running: Array<{
      runId: string;
      issueKey: string;
      provider: string;
      currentAgent?: string;
      lastActivityDescription?: string;
      toolCallCount?: number;
      startedAt?: string;
    }>;
    retryQueue: string[];
    metrics: { tokensIn: number; tokensOut: number; runs: number };
  };
  getRecentRuns?: () => DashboardRun[];
  getDurationStats?: () => DurationStats;
  getStatusCounts?: () => StatusCounts;
  getTotalTokens?: () => { tokensIn: number; tokensOut: number; runs: number };
  runsRepo?: RunsRepo;
  cancelRun?: (runId: string) => boolean;
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

  api.get("/runs/:id", (c) => {
    if (!ctx.runsRepo) {
      return c.json({ error: "Runs not available" }, 500);
    }
    const id = c.req.param("id");
    const run = ctx.runsRepo.getById(id);
    if (!run) {
      return c.json({ error: "Run not found" }, 404);
    }
    return c.json(run);
  });

  api.post("/runs/:id/cancel", (c) => {
    const id = c.req.param("id");
    if (!ctx.cancelRun) {
      return c.json({ error: "Cancel not available" }, 404);
    }
    const cancelled = ctx.cancelRun(id);
    if (!cancelled) {
      return c.json({ error: "Run not found or not running" }, 404);
    }
    return c.json({ ok: true });
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
    const estimatedCost = getCostEstimate(tokens.tokensIn, tokens.tokensOut);
    return c.json({ duration, tokens, runs, estimatedCost });
  });

  return api;
}
