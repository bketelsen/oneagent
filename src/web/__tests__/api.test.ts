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
});
