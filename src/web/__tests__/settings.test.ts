import { describe, it, expect } from "vitest";
import { maskToken } from "../routes/settings.js";
import { createApp } from "../app.js";
import { SSEHub } from "../sse.js";
import type { Config } from "../../config/schema.js";

describe("maskToken", () => {
  it("masks a ghp_ prefixed token, showing prefix and last 4 chars", () => {
    expect(maskToken("ghp_abc123secret9xyz")).toBe("ghp_****9xyz");
  });

  it("masks a github_pat_ prefixed token", () => {
    expect(maskToken("github_pat_longtoken1234")).toBe("github_pat_****1234");
  });

  it("masks a token without a known prefix", () => {
    expect(maskToken("someplaintoken5678")).toBe("****5678");
  });

  it("returns 'Not configured' for undefined", () => {
    expect(maskToken(undefined)).toBe("Not configured");
  });

  it("returns 'Not configured' for empty string", () => {
    expect(maskToken("")).toBe("Not configured");
  });

  it("returns masked value for very short token", () => {
    expect(maskToken("abcd")).toBe("****");
  });
});

describe("Settings route", () => {
  function makeApp(token?: string) {
    const config: Config = {
      github: {
        token,
        repos: [{ owner: "test", repo: "repo", labels: ["bug"] }],
      },
      agent: { provider: "claude-code", stallTimeout: 300000, maxRetries: 3, retryBaseDelay: 60000 },
      concurrency: { max: 3 },
      poll: { interval: 30000, reconcileInterval: 15000 },
      project: { statuses: { todo: "Todo", inProgress: "In Progress", inReview: "In Review", done: "Done" } },
      workspace: { baseDir: "./workspaces", hooks: {} },
      labels: { eligible: "oneagent", inProgress: "oneagent-working", failed: "oneagent-failed", needsReview: "oneagent-needs-review", needsHuman: "oneagent-needs-human" },
      web: { port: 3000, enabled: true },
      prReview: { enabled: true, pollInterval: 60000, provider: "claude-code", autoMerge: false, maxReviewCycles: 3, requireChecks: true },
    };

    return createApp({
      app: {
        sseHub: new SSEHub(),
        onRefresh: async () => {},
        getState: () => ({ running: [], retryQueue: [], metrics: { tokensIn: 0, tokensOut: 0, runs: 0 } }),
        getRecentRuns: () => [],
      },
      getConfig: () => config,
    });
  }

  it("never sends the full token to the browser", async () => {
    const fullToken = "ghp_abcdef1234567890secretXYZW";
    const app = makeApp(fullToken);
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).not.toContain(fullToken);
    expect(html).toContain("ghp_****XYZW");
  });

  it("shows 'Not configured' when token is undefined", async () => {
    const app = makeApp(undefined);
    const res = await app.request("/settings");
    const html = await res.text();
    expect(html).toContain("Not configured");
  });
});
