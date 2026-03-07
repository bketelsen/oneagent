import { describe, it, expect, vi } from "vitest";
import { PRMonitor } from "../pr-monitor.js";

function createMockGitHub() {
  return {
    fetchPRsWithLabel: vi.fn().mockResolvedValue([]),
    fetchCheckRuns: vi.fn().mockResolvedValue([]),
    fetchPRReviewComments: vi.fn().mockResolvedValue([]),
    fetchPRsWithReviewFeedback: vi.fn().mockResolvedValue([]),
    fetchPRDiff: vi.fn().mockResolvedValue("diff --git a/file.ts"),
    issueKey: (o: string, r: string, n: number) => `${o}/${r}#${n}`,
    parseIssueKey: (key: string) => {
      const match = key.match(/^(.+)\/(.+)#(\d+)$/);
      if (!match) return null;
      return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
    },
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

const baseConfig = {
  github: { repos: [{ owner: "o", repo: "r", labels: ["oneagent"] }] },
  agent: { provider: "claude-code", stallTimeout: 300000, maxRetries: 3, retryBaseDelay: 60000 },
  concurrency: { max: 3 },
  poll: { interval: 30000, reconcileInterval: 15000 },
  labels: { eligible: "oneagent", inProgress: "oneagent-working", failed: "oneagent-failed" },
  workspace: { baseDir: "/tmp/test-ws", hooks: {} },
  web: { port: 3000, enabled: false },
  project: { statuses: { todo: "Todo", inProgress: "In Progress", inReview: "In Review", done: "Done" } },
  prReview: { enabled: true, pollInterval: 60000 },
};

describe("PRMonitor", () => {
  it("can be constructed", () => {
    const monitor = new PRMonitor(baseConfig as any, createMockGitHub() as any, createMockLogger() as any);
    expect(monitor).toBeDefined();
  });

  it("checkReviewFeedback returns empty when no PRs have feedback", async () => {
    const github = createMockGitHub();
    const monitor = new PRMonitor(baseConfig as any, github as any, createMockLogger() as any);
    const results = await monitor.checkReviewFeedback();
    expect(results).toEqual([]);
    expect(github.fetchPRsWithReviewFeedback).toHaveBeenCalledWith("o", "r", "oneagent-working", expect.any(Map));
  });

  it("checkReviewFeedback returns results when PRs have new review comments", async () => {
    const github = createMockGitHub();
    github.fetchPRsWithReviewFeedback.mockResolvedValue([
      {
        pr: {
          key: "o/r#10",
          owner: "o",
          repo: "r",
          number: 10,
          title: "Add feature",
          headRef: "feature-branch",
          state: "open",
          labels: ["oneagent-working"],
        },
        comments: [
          { id: 100, body: "Please fix the typo", path: "src/index.ts", user: "reviewer", createdAt: "2026-01-01T00:00:00Z", pullRequestReviewId: 1 },
        ],
        latestCommentId: 100,
      },
    ]);

    const monitor = new PRMonitor(baseConfig as any, github as any, createMockLogger() as any);
    const results = await monitor.checkReviewFeedback();

    expect(results).toHaveLength(1);
    expect(results[0].prKey).toBe("o/r#10");
    expect(results[0].commentCount).toBe(1);
    expect(results[0].latestCommentId).toBe(100);
    expect(results[0].prompt).toContain("Please fix the typo");
    expect(results[0].prompt).toContain("feature-branch");
    expect(results[0].headRef).toBe("feature-branch");
  });

  it("markReviewProcessed tracks last processed comment ID", () => {
    const monitor = new PRMonitor(baseConfig as any, createMockGitHub() as any, createMockLogger() as any);
    expect(monitor.getLastProcessedCommentId("o/r#10")).toBeUndefined();

    monitor.markReviewProcessed("o/r#10", 100);
    expect(monitor.getLastProcessedCommentId("o/r#10")).toBe(100);

    monitor.markReviewProcessed("o/r#10", 200);
    expect(monitor.getLastProcessedCommentId("o/r#10")).toBe(200);
  });

  it("checkReviewFeedback includes diff in prompt", async () => {
    const github = createMockGitHub();
    github.fetchPRsWithReviewFeedback.mockResolvedValue([
      {
        pr: {
          key: "o/r#5",
          owner: "o",
          repo: "r",
          number: 5,
          title: "Some PR",
          headRef: "branch-5",
          state: "open",
          labels: ["oneagent-working"],
        },
        comments: [
          { id: 50, body: "Fix this", path: "a.ts", user: "alice", createdAt: "2026-01-01", pullRequestReviewId: 1 },
        ],
        latestCommentId: 50,
      },
    ]);
    github.fetchPRDiff.mockResolvedValue("+added line\n-removed line");

    const monitor = new PRMonitor(baseConfig as any, github as any, createMockLogger() as any);
    const results = await monitor.checkReviewFeedback();

    expect(results).toHaveLength(1);
    expect(results[0].prompt).toContain("+added line");
    expect(results[0].prompt).toContain("-removed line");
  });

  it("checkReviewFeedback handles diff fetch failure gracefully", async () => {
    const github = createMockGitHub();
    github.fetchPRsWithReviewFeedback.mockResolvedValue([
      {
        pr: {
          key: "o/r#5",
          owner: "o",
          repo: "r",
          number: 5,
          title: "Some PR",
          headRef: "branch-5",
          state: "open",
          labels: ["oneagent-working"],
        },
        comments: [
          { id: 50, body: "Fix this", path: "a.ts", user: "alice", createdAt: "2026-01-01", pullRequestReviewId: 1 },
        ],
        latestCommentId: 50,
      },
    ]);
    github.fetchPRDiff.mockRejectedValue(new Error("network error"));

    const logger = createMockLogger();
    const monitor = new PRMonitor(baseConfig as any, github as any, logger as any);
    const results = await monitor.checkReviewFeedback();

    expect(results).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("start and stop manage timers correctly", () => {
    const monitor = new PRMonitor(baseConfig as any, createMockGitHub() as any, createMockLogger() as any);
    monitor.start(30000);
    monitor.startReviewPolling(60000);
    // Should not throw
    monitor.stop();
  });
});
