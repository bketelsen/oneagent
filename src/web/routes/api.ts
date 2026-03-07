import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEHub } from "../sse.js";

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

  return api;
}
