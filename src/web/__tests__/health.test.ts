import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApp } from "../app.js";
import { SSEHub } from "../sse.js";

describe("GET /health", () => {
  let startTime: number;

  beforeEach(() => {
    startTime = Date.now();
  });

  function makeApp() {
    return createApp({
      sseHub: new SSEHub(),
      onRefresh: async () => {},
      getState: () => ({ running: [], retryQueue: [], metrics: { tokensIn: 0, tokensOut: 0, runs: 0 } }),
    });
  }

  it("returns 200 with expected JSON shape", async () => {
    const app = makeApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.version).toBe("0.1.0");
  });

  it("returns increasing uptime on subsequent calls", async () => {
    const app = makeApp();

    const res1 = await app.request("/health");
    const body1 = await res1.json();

    // Small delay to ensure uptime increases
    await new Promise((r) => setTimeout(r, 50));

    const res2 = await app.request("/health");
    const body2 = await res2.json();

    expect(body2.uptime).toBeGreaterThanOrEqual(body1.uptime);
  });
});
