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

  describe("poll.interval minimum", () => {
    const baseConfig = {
      github: {
        repos: [{ owner: "test", repo: "repo", labels: ["oneagent"] }],
      },
    };

    it("accepts poll.interval >= 5000", () => {
      const result = configSchema.safeParse({
        ...baseConfig,
        poll: { interval: 5000 },
      });
      expect(result.success).toBe(true);
    });

    it("accepts poll.interval well above 5000", () => {
      const result = configSchema.safeParse({
        ...baseConfig,
        poll: { interval: 30000 },
      });
      expect(result.success).toBe(true);
    });

    it("rejects poll.interval below 5000", () => {
      const result = configSchema.safeParse({
        ...baseConfig,
        poll: { interval: 1000 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects poll.interval of 0", () => {
      const result = configSchema.safeParse({
        ...baseConfig,
        poll: { interval: 0 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("poll.reconcileInterval minimum", () => {
    const baseConfig = {
      github: {
        repos: [{ owner: "test", repo: "repo", labels: ["oneagent"] }],
      },
    };

    it("accepts poll.reconcileInterval >= 5000", () => {
      const result = configSchema.safeParse({
        ...baseConfig,
        poll: { reconcileInterval: 5000 },
      });
      expect(result.success).toBe(true);
    });

    it("rejects poll.reconcileInterval below 5000", () => {
      const result = configSchema.safeParse({
        ...baseConfig,
        poll: { reconcileInterval: 1000 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("prReview config", () => {
    const baseConfig = {
      github: {
        repos: [{ owner: "test", repo: "repo", labels: ["oneagent"] }],
      },
    };

    it("defaults prReview.enabled to true", () => {
      const result = configSchema.parse(baseConfig);
      expect(result.prReview.enabled).toBe(true);
    });

    it("defaults prReview.pollInterval to 60000", () => {
      const result = configSchema.parse(baseConfig);
      expect(result.prReview.pollInterval).toBe(60000);
    });

    it("accepts explicit prReview config", () => {
      const result = configSchema.safeParse({
        ...baseConfig,
        prReview: { enabled: false, pollInterval: 120000 },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.prReview.enabled).toBe(false);
        expect(result.data.prReview.pollInterval).toBe(120000);
      }
    });

    it("rejects prReview.pollInterval below 5000", () => {
      const result = configSchema.safeParse({
        ...baseConfig,
        prReview: { pollInterval: 1000 },
      });
      expect(result.success).toBe(false);
    });

    it("defaults prReview.provider to 'claude-code'", () => {
      const result = configSchema.parse(baseConfig);
      expect(result.prReview.provider).toBe("claude-code");
    });

    it("defaults prReview.autoMerge to false", () => {
      const result = configSchema.parse(baseConfig);
      expect(result.prReview.autoMerge).toBe(false);
    });

    it("defaults prReview.maxReviewCycles to 2", () => {
      const result = configSchema.parse(baseConfig);
      expect(result.prReview.maxReviewCycles).toBe(2);
    });

    it("defaults prReview.requireChecks to true", () => {
      const result = configSchema.parse(baseConfig);
      expect(result.prReview.requireChecks).toBe(true);
    });

    it("accepts explicit prReview provider and model", () => {
      const result = configSchema.safeParse({
        ...baseConfig,
        prReview: { provider: "anthropic", model: "claude-sonnet-4-6" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.prReview.provider).toBe("anthropic");
        expect(result.data.prReview.model).toBe("claude-sonnet-4-6");
      }
    });

    it("rejects prReview.maxReviewCycles below 1", () => {
      const result = configSchema.safeParse({
        ...baseConfig,
        prReview: { maxReviewCycles: 0 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("labels config", () => {
    const baseConfig = {
      github: {
        repos: [{ owner: "test", repo: "repo", labels: ["oneagent"] }],
      },
    };

    it("defaults labels.needsReview to 'oneagent-needs-review'", () => {
      const result = configSchema.parse(baseConfig);
      expect(result.labels.needsReview).toBe("oneagent-needs-review");
    });

    it("defaults labels.needsHuman to 'oneagent-needs-human'", () => {
      const result = configSchema.parse(baseConfig);
      expect(result.labels.needsHuman).toBe("oneagent-needs-human");
    });
  });
});
