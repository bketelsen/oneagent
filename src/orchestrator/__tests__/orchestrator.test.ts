import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "../orchestrator.js";

vi.mock("one-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    run: vi.fn(),
  };
});

import { run as mockRunFn } from "one-agent-sdk";

function makeMockGitHub() {
  return {
    fetchIssues: vi.fn().mockResolvedValue([]),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    fetchPRsWithLabel: vi.fn().mockResolvedValue([]),
    fetchPRReviewComments: vi.fn().mockResolvedValue([]),
    fetchPRsWithReviewFeedback: vi.fn().mockResolvedValue([]),
    fetchPRDiff: vi.fn().mockResolvedValue(""),
    fetchCheckRuns: vi.fn().mockResolvedValue([]),
    issueKey: (o: string, r: string, n: number) => `${o}/${r}#${n}`,
    parseIssueKey: (key: string) => {
      const match = key.match(/^(.+)\/(.+)#(\d+)$/);
      if (!match) return null;
      return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
    },
  };
}

function makeMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

const mockConfig = {
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

describe("Orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("can be constructed", () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger } as any);
    expect(orch).toBeDefined();
  });

  it("tick fetches issues from all repos", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger } as any);
    await orch.tick();
    expect(mockGitHub.fetchIssues).toHaveBeenCalledWith("o", "r", ["oneagent"]);
  });

  it("calls completeRun on success with duration", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    const mockRunsRepo = {
      insert: vi.fn(),
      completeRun: vi.fn(),
      updateStatus: vi.fn(),
    };

    const issue = {
      key: "o/r#1",
      owner: "o",
      repo: "r",
      number: 1,
      title: "Test issue",
      body: "test body",
      labels: ["oneagent"],
      hasOpenPR: false,
    };

    mockGitHub.fetchIssues.mockResolvedValue([issue]);

    const mockStream = (async function* () {
      yield { type: "done", usage: { inputTokens: 100, outputTokens: 50 } };
    })();
    (mockRunFn as any).mockResolvedValue({ stream: mockStream });

    const orch = new Orchestrator(
      mockConfig as any,
      mockGitHub as any,
      {
        config: mockConfig,
        github: mockGitHub,
        runsRepo: mockRunsRepo,
        logger: mockLogger,
      } as any,
    );

    await orch.tick();

    // Wait for the background executeRun to finish
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockRunsRepo.insert).toHaveBeenCalledTimes(1);
    expect(mockRunsRepo.completeRun).toHaveBeenCalledTimes(1);
    expect(mockRunsRepo.updateStatus).not.toHaveBeenCalled();

    const [id, status, completedAt, durationMs] = mockRunsRepo.completeRun.mock.calls[0];
    expect(status).toBe("completed");
    expect(typeof completedAt).toBe("string");
    expect(typeof durationMs).toBe("number");
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it("calls completeRun on failure with duration and error", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    const mockRunsRepo = {
      insert: vi.fn(),
      completeRun: vi.fn(),
      updateStatus: vi.fn(),
    };

    const issue = {
      key: "o/r#2",
      owner: "o",
      repo: "r",
      number: 2,
      title: "Failing issue",
      body: "test body",
      labels: ["oneagent"],
      hasOpenPR: false,
    };

    mockGitHub.fetchIssues.mockResolvedValue([issue]);

    (mockRunFn as any).mockRejectedValue(new Error("agent crashed"));

    const orch = new Orchestrator(
      mockConfig as any,
      mockGitHub as any,
      {
        config: mockConfig,
        github: mockGitHub,
        runsRepo: mockRunsRepo,
        logger: mockLogger,
      } as any,
    );

    await orch.tick();

    // Wait for the background executeRun to finish
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockRunsRepo.insert).toHaveBeenCalledTimes(1);
    expect(mockRunsRepo.completeRun).toHaveBeenCalledTimes(1);
    expect(mockRunsRepo.updateStatus).not.toHaveBeenCalled();

    const [id, status, completedAt, durationMs, error] = mockRunsRepo.completeRun.mock.calls[0];
    expect(status).toBe("failed");
    expect(typeof completedAt).toBe("string");
    expect(typeof durationMs).toBe("number");
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(error).toBe("agent crashed");
  });

  it("has a prMonitor instance", () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger } as any);
    expect(orch.prMonitor).toBeDefined();
  });

  it("tickReviewFeedback does nothing when prReview is disabled", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    const disabledConfig = { ...mockConfig, prReview: { enabled: false, pollInterval: 60000 } };
    const orch = new Orchestrator(disabledConfig as any, mockGitHub as any, { config: disabledConfig, github: mockGitHub, logger: mockLogger } as any);
    await orch.tickReviewFeedback();
    expect(mockGitHub.fetchPRsWithReviewFeedback).not.toHaveBeenCalled();
  });

  it("tickReviewFeedback polls for review feedback when enabled", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    mockGitHub.fetchPRsWithReviewFeedback.mockResolvedValue([]);
    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger } as any);
    await orch.tickReviewFeedback();
    expect(mockGitHub.fetchPRsWithReviewFeedback).toHaveBeenCalled();
  });

  it("start sets up review timer when prReview is enabled", () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger } as any);
    orch.start();
    orch.stop();
  });

  it("start does not set up review timer when prReview is disabled", () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    const disabledConfig = { ...mockConfig, prReview: { enabled: false, pollInterval: 60000 } };
    const orch = new Orchestrator(disabledConfig as any, mockGitHub as any, { config: disabledConfig, github: mockGitHub, logger: mockLogger } as any);
    orch.start();
    orch.stop();
  });
});
