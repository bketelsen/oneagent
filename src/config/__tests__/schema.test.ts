import { describe, it, expect } from "vitest";
import { configSchema } from "../schema.js";

describe("configSchema", () => {
  it("validates a minimal valid config", () => {
    const result = configSchema.safeParse({
      github: {
        repos: [{ owner: "test", repo: "repo", labels: ["oneagent"] }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects config missing repos", () => {
    const result = configSchema.safeParse({ github: {} });
    expect(result.success).toBe(false);
  });

  it("applies defaults for optional fields", () => {
    const result = configSchema.parse({
      github: {
        repos: [{ owner: "test", repo: "repo", labels: ["oneagent"] }],
      },
    });
    expect(result.agent.provider).toBe("claude-code");
    expect(result.agent.stallTimeout).toBe(300000);
    expect(result.agent.maxRetries).toBe(3);
    expect(result.concurrency.max).toBe(3);
    expect(result.poll.interval).toBe(30000);
    expect(result.web.port).toBe(3000);
    expect(result.web.enabled).toBe(true);
  });
});
