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

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

function makeMockGitHub() {
  return {
    fetchIssues: vi.fn().mockResolvedValue([]),
    addLabel: vi.fn().mockResolvedValue(undefined),
    removeLabel: vi.fn().mockResolvedValue(undefined),
    addComment: vi.fn().mockResolvedValue(undefined),
    findMergedPRForIssue: vi.fn().mockResolvedValue(null),
    fetchPRsWithLabel: vi.fn().mockResolvedValue([]),
    fetchPRReviewComments: vi.fn().mockResolvedValue([]),
    fetchPRsWithReviewFeedback: vi.fn().mockResolvedValue([]),
    fetchPRDiff: vi.fn().mockResolvedValue(""),
    fetchCheckRuns: vi.fn().mockResolvedValue([]),
    listOpenPRs: vi.fn().mockResolvedValue([]),
    getPRMergeability: vi.fn().mockResolvedValue(true),
    parseDependencies: vi.fn().mockReturnValue([]),
    isIssueClosed: vi.fn().mockResolvedValue(true),
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

  it("removes inProgress and eligible labels on successful completion", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    const mockRunsRepo = {
      insert: vi.fn(),
      completeRun: vi.fn(),
      updateStatus: vi.fn(),
    };

    const issue = {
      key: "o/r#10",
      owner: "o",
      repo: "r",
      number: 10,
      title: "Label cleanup test",
      body: "test body",
      labels: ["oneagent"],
      hasOpenPR: false,
    };

    mockGitHub.fetchIssues.mockResolvedValue([issue]);

    const mockStream = (async function* () {
      yield { type: "done", usage: { inputTokens: 10, outputTokens: 5 } };
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
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should remove both inProgress and eligible labels
    expect(mockGitHub.removeLabel).toHaveBeenCalledWith("o", "r", 10, "oneagent-working");
    expect(mockGitHub.removeLabel).toHaveBeenCalledWith("o", "r", 10, "oneagent");
    expect(mockGitHub.removeLabel).toHaveBeenCalledTimes(2);
  });

  it("removes inProgress label on failure", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    const mockRunsRepo = {
      insert: vi.fn(),
      completeRun: vi.fn(),
      updateStatus: vi.fn(),
    };

    const issue = {
      key: "o/r#11",
      owner: "o",
      repo: "r",
      number: 11,
      title: "Failure label cleanup test",
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
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should remove inProgress label even on failure
    expect(mockGitHub.removeLabel).toHaveBeenCalledWith("o", "r", 11, "oneagent-working");
  });

  it("start does not set up review timer when prReview is disabled", () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();
    const disabledConfig = { ...mockConfig, prReview: { enabled: false, pollInterval: 60000 } };
    const orch = new Orchestrator(disabledConfig as any, mockGitHub as any, { config: disabledConfig, github: mockGitHub, logger: mockLogger } as any);
    orch.start();
    orch.stop();
  });

  it("skips issue resolved by merged PR and posts comment", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    const issue = {
      key: "o/r#10",
      owner: "o",
      repo: "r",
      number: 10,
      title: "Already resolved",
      body: "resolved issue",
      labels: ["oneagent"],
      state: "open",
      hasOpenPR: false,
    };

    mockGitHub.fetchIssues.mockResolvedValue([issue]);
    mockGitHub.findMergedPRForIssue.mockResolvedValue({ number: 42 });

    const orch = new Orchestrator(
      mockConfig as any,
      mockGitHub as any,
      { config: mockConfig, github: mockGitHub, logger: mockLogger } as any,
    );

    await orch.tick();

    // Should not dispatch (no addLabel for in-progress)
    expect(mockGitHub.addLabel).not.toHaveBeenCalled();

    // Should post a comment suggesting closure
    expect(mockGitHub.addComment).toHaveBeenCalledWith(
      "o", "r", 10,
      "This issue appears to have been resolved by PR #42 (merged). Skipping. Consider closing this issue.",
    );

    // Should log the skip at info level
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: "o/r#10", prNumber: 42 }),
      "skipping issue already resolved by merged PR",
    );
  });

  it("dispatches issue without merged PR normally", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    const issue = {
      key: "o/r#11",
      owner: "o",
      repo: "r",
      number: 11,
      title: "New issue",
      body: "needs work",
      labels: ["oneagent"],
      state: "open",
      hasOpenPR: false,
    };

    mockGitHub.fetchIssues.mockResolvedValue([issue]);
    mockGitHub.findMergedPRForIssue.mockResolvedValue(null);

    const mockStream = (async function* () {
      yield { type: "done", usage: { inputTokens: 10, outputTokens: 5 } };
    })();
    (mockRunFn as any).mockResolvedValue({ stream: mockStream });

    const orch = new Orchestrator(
      mockConfig as any,
      mockGitHub as any,
      { config: mockConfig, github: mockGitHub, logger: mockLogger } as any,
    );

    await orch.tick();

    // Should dispatch — addLabel is called for in-progress
    expect(mockGitHub.addLabel).toHaveBeenCalledWith("o", "r", 11, "oneagent-working");

    // Should not post a closure comment
    expect(mockGitHub.addComment).not.toHaveBeenCalled();
  });

  it("posts comment on skipped issue suggesting closure", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    const issue = {
      key: "o/r#20",
      owner: "o",
      repo: "r",
      number: 20,
      title: "Resolved by PR",
      body: "already done",
      labels: ["oneagent"],
      state: "open",
      hasOpenPR: false,
    };

    mockGitHub.fetchIssues.mockResolvedValue([issue]);
    mockGitHub.findMergedPRForIssue.mockResolvedValue({ number: 99 });

    const orch = new Orchestrator(
      mockConfig as any,
      mockGitHub as any,
      { config: mockConfig, github: mockGitHub, logger: mockLogger } as any,
    );

    await orch.tick();

    expect(mockGitHub.addComment).toHaveBeenCalledTimes(1);
    expect(mockGitHub.addComment).toHaveBeenCalledWith(
      "o", "r", 20,
      expect.stringContaining("PR #99"),
    );
    expect(mockGitHub.addComment).toHaveBeenCalledWith(
      "o", "r", 20,
      expect.stringContaining("Consider closing this issue"),
    );
  });

  it("skips issue when it has an open dependency", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    const issue = {
      key: "o/r#5",
      owner: "o",
      repo: "r",
      number: 5,
      title: "Dependent issue",
      body: "Depends on #3",
      labels: ["oneagent"],
      state: "open",
      hasOpenPR: false,
    };

    mockGitHub.fetchIssues.mockResolvedValue([issue]);
    mockGitHub.findMergedPRForIssue.mockResolvedValue(null);
    mockGitHub.parseDependencies.mockReturnValue([3]);
    mockGitHub.isIssueClosed.mockResolvedValue(false);

    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger } as any);
    await orch.tick();

    expect(mockGitHub.parseDependencies).toHaveBeenCalledWith("Depends on #3");
    expect(mockGitHub.isIssueClosed).toHaveBeenCalledWith("o", "r", 3);
    expect(mockGitHub.addLabel).not.toHaveBeenCalled(); // dispatch was not called
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: "o/r#5", blockedBy: 3 }),
      "skipping issue with open dependency",
    );
  });

  it("dispatches issue when all dependencies are closed", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    const issue = {
      key: "o/r#5",
      owner: "o",
      repo: "r",
      number: 5,
      title: "Dependent issue",
      body: "Depends on #3",
      labels: ["oneagent"],
      state: "open",
      hasOpenPR: false,
    };

    mockGitHub.fetchIssues.mockResolvedValue([issue]);
    mockGitHub.findMergedPRForIssue.mockResolvedValue(null);
    mockGitHub.parseDependencies.mockReturnValue([3]);
    mockGitHub.isIssueClosed.mockResolvedValue(true);

    const mockStream = (async function* () {
      yield { type: "done", usage: { inputTokens: 10, outputTokens: 5 } };
    })();
    (mockRunFn as any).mockResolvedValue({ stream: mockStream });

    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger } as any);
    await orch.tick();

    expect(mockGitHub.addLabel).toHaveBeenCalled(); // dispatch was called
  });

  it("dispatches issue with no dependencies normally", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    const issue = {
      key: "o/r#6",
      owner: "o",
      repo: "r",
      number: 6,
      title: "Independent issue",
      body: "No dependencies here",
      labels: ["oneagent"],
      state: "open",
      hasOpenPR: false,
    };

    mockGitHub.fetchIssues.mockResolvedValue([issue]);
    mockGitHub.findMergedPRForIssue.mockResolvedValue(null);
    mockGitHub.parseDependencies.mockReturnValue([]);

    const mockStream = (async function* () {
      yield { type: "done", usage: { inputTokens: 10, outputTokens: 5 } };
    })();
    (mockRunFn as any).mockResolvedValue({ stream: mockStream });

    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger } as any);
    await orch.tick();

    expect(mockGitHub.parseDependencies).toHaveBeenCalledWith("No dependencies here");
    expect(mockGitHub.isIssueClosed).not.toHaveBeenCalled();
    expect(mockGitHub.addLabel).toHaveBeenCalled(); // dispatch was called
  });

  describe("rebaseConflictingPRs", () => {
    it("rebases PRs that have merge conflicts", async () => {
      const mockGitHub = makeMockGitHub();
      const mockLogger = makeMockLogger();
      const mockWorkspace = { ensure: vi.fn().mockReturnValue("/tmp/ws") };

      mockGitHub.listOpenPRs.mockResolvedValue([
        { key: "o/r#10", owner: "o", repo: "r", number: 10, title: "PR 10", headRef: "feature-branch", state: "open", labels: [] },
      ]);
      mockGitHub.getPRMergeability.mockResolvedValue(false);

      // Mock execFile to succeed
      const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
        cb(null, "", "");
      });

      const orch = new Orchestrator(
        mockConfig as any,
        mockGitHub as any,
        { config: mockConfig, github: mockGitHub, logger: mockLogger, workspace: mockWorkspace } as any,
      );

      await orch.rebaseConflictingPRs("o", "r");

      expect(mockGitHub.listOpenPRs).toHaveBeenCalledWith("o", "r");
      expect(mockGitHub.getPRMergeability).toHaveBeenCalledWith("o", "r", 10);
      expect(mockExecFile).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ prNumber: 10, branch: "feature-branch" }),
        "successfully rebased PR",
      );
    });

    it("posts comment on PR when rebase fails with unresolvable conflicts", async () => {
      const mockGitHub = makeMockGitHub();
      const mockLogger = makeMockLogger();
      const mockWorkspace = { ensure: vi.fn().mockReturnValue("/tmp/ws") };

      mockGitHub.listOpenPRs.mockResolvedValue([
        { key: "o/r#20", owner: "o", repo: "r", number: 20, title: "PR 20", headRef: "conflict-branch", state: "open", labels: [] },
      ]);
      mockGitHub.getPRMergeability.mockResolvedValue(false);

      // Mock execFile to fail on rebase step
      const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;
      let callCount = 0;
      mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
        callCount++;
        if (args[0] === "rebase") {
          cb(new Error("CONFLICT: merge conflict in file.ts"), "", "");
        } else {
          cb(null, "", "");
        }
      });

      const orch = new Orchestrator(
        mockConfig as any,
        mockGitHub as any,
        { config: mockConfig, github: mockGitHub, logger: mockLogger, workspace: mockWorkspace } as any,
      );

      await orch.rebaseConflictingPRs("o", "r");

      expect(mockGitHub.addComment).toHaveBeenCalledWith(
        "o", "r", 20,
        expect.stringContaining("Auto-rebase failed"),
      );
      expect(mockGitHub.addComment).toHaveBeenCalledWith(
        "o", "r", 20,
        expect.stringContaining("conflict-branch"),
      );
    });

    it("skips PRs that are mergeable", async () => {
      const mockGitHub = makeMockGitHub();
      const mockLogger = makeMockLogger();
      const mockWorkspace = { ensure: vi.fn().mockReturnValue("/tmp/ws") };

      mockGitHub.listOpenPRs.mockResolvedValue([
        { key: "o/r#30", owner: "o", repo: "r", number: 30, title: "PR 30", headRef: "clean-branch", state: "open", labels: [] },
      ]);
      mockGitHub.getPRMergeability.mockResolvedValue(true);

      const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

      const orch = new Orchestrator(
        mockConfig as any,
        mockGitHub as any,
        { config: mockConfig, github: mockGitHub, logger: mockLogger, workspace: mockWorkspace } as any,
      );

      await orch.rebaseConflictingPRs("o", "r");

      expect(mockExecFile).not.toHaveBeenCalled();
      expect(mockGitHub.addComment).not.toHaveBeenCalled();
    });

    it("skips PRs where mergeability is null (unknown)", async () => {
      const mockGitHub = makeMockGitHub();
      const mockLogger = makeMockLogger();
      const mockWorkspace = { ensure: vi.fn().mockReturnValue("/tmp/ws") };

      mockGitHub.listOpenPRs.mockResolvedValue([
        { key: "o/r#40", owner: "o", repo: "r", number: 40, title: "PR 40", headRef: "unknown-branch", state: "open", labels: [] },
      ]);
      mockGitHub.getPRMergeability.mockResolvedValue(null);

      const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

      const orch = new Orchestrator(
        mockConfig as any,
        mockGitHub as any,
        { config: mockConfig, github: mockGitHub, logger: mockLogger, workspace: mockWorkspace } as any,
      );

      await orch.rebaseConflictingPRs("o", "r");

      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it("handles no open PRs gracefully", async () => {
      const mockGitHub = makeMockGitHub();
      const mockLogger = makeMockLogger();

      mockGitHub.listOpenPRs.mockResolvedValue([]);

      const orch = new Orchestrator(
        mockConfig as any,
        mockGitHub as any,
        { config: mockConfig, github: mockGitHub, logger: mockLogger } as any,
      );

      await orch.rebaseConflictingPRs("o", "r");

      expect(mockGitHub.getPRMergeability).not.toHaveBeenCalled();
    });
  });
});
