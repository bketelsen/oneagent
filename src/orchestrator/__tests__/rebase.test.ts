import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "../orchestrator.js";

vi.mock("one-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    run: vi.fn(),
  };
});

// Mock child_process execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn((cmd: string, args: string[], optsOrCb: any, cb?: any) => {
    const callback = typeof optsOrCb === "function" ? optsOrCb : cb;
    callback(null, "", "");
  }),
}));

// Mock fs for cleanup
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
  };
});

import { execFile as execFileCb } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

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
    fetchOpenPRs: vi.fn().mockResolvedValue([]),
    fetchPRMergeableStatus: vi.fn().mockResolvedValue({ mergeable: true, mergeableState: "clean" }),
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
  github: { repos: [{ owner: "o", repo: "r", labels: ["oneagent"] }], token: "test-token" },
  agent: { provider: "claude-code", stallTimeout: 300000, maxRetries: 3, retryBaseDelay: 60000 },
  concurrency: { max: 3 },
  poll: { interval: 30000, reconcileInterval: 15000 },
  labels: { eligible: "oneagent", inProgress: "oneagent-working", failed: "oneagent-failed" },
  workspace: { baseDir: "/tmp/test-ws", hooks: {} },
  web: { port: 3000, enabled: false },
  project: { statuses: { todo: "Todo", inProgress: "In Progress", inReview: "In Review", done: "Done" } },
  prReview: { enabled: false, pollInterval: 60000 },
};

describe("rebaseConflictingPRs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips PRs that are not conflicting (mergeable=true)", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    mockGitHub.fetchOpenPRs.mockResolvedValue([
      { key: "o/r#5", owner: "o", repo: "r", number: 5, title: "Clean PR", headRef: "feat-5", state: "open", labels: [] },
    ]);
    mockGitHub.fetchPRMergeableStatus.mockResolvedValue({ mergeable: true, mergeableState: "clean" });

    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger, sseHub: { broadcast: vi.fn() } } as any);
    await orch.rebaseConflictingPRs("o", "r");

    expect(mockGitHub.fetchOpenPRs).toHaveBeenCalledWith("o", "r");
    expect(mockGitHub.fetchPRMergeableStatus).toHaveBeenCalledWith("o", "r", 5);
    // Should not attempt clone/rebase
    expect(execFileCb).not.toHaveBeenCalled();
  });

  it("skips PRs with unknown mergeable status (null)", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    mockGitHub.fetchOpenPRs.mockResolvedValue([
      { key: "o/r#5", owner: "o", repo: "r", number: 5, title: "Unknown PR", headRef: "feat-5", state: "open", labels: [] },
    ]);
    mockGitHub.fetchPRMergeableStatus.mockResolvedValue({ mergeable: null, mergeableState: "unknown" });

    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger, sseHub: { broadcast: vi.fn() } } as any);
    await orch.rebaseConflictingPRs("o", "r");

    expect(execFileCb).not.toHaveBeenCalled();
  });

  it("clones, rebases, and force-pushes conflicting PRs", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    mockGitHub.fetchOpenPRs.mockResolvedValue([
      { key: "o/r#7", owner: "o", repo: "r", number: 7, title: "Conflicting PR", headRef: "feat-7", state: "open", labels: [] },
    ]);
    mockGitHub.fetchPRMergeableStatus.mockResolvedValue({ mergeable: false, mergeableState: "dirty" });

    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger, sseHub: { broadcast: vi.fn() } } as any);
    await orch.rebaseConflictingPRs("o", "r");

    // Verify git commands were called
    const calls = (execFileCb as any).mock.calls;
    expect(calls.length).toBe(4);

    // Clone with authenticated URL
    expect(calls[0][0]).toBe("git");
    expect(calls[0][1]).toContain("clone");
    expect(calls[0][1]).toContain("--branch");
    expect(calls[0][1]).toContain("feat-7");
    expect(calls[0][1][4]).toContain("x-access-token:test-token@github.com/o/r.git");

    // Fetch origin main
    expect(calls[1][1]).toEqual(["fetch", "origin", "main"]);

    // Rebase
    expect(calls[2][1]).toEqual(["rebase", "origin/main"]);

    // Force push
    expect(calls[3][1]).toEqual(["push", "--force-with-lease"]);

    // Workspace cleaned up
    expect(rmSync).toHaveBeenCalled();
  });

  it("aborts rebase and posts comment when rebase fails", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    mockGitHub.fetchOpenPRs.mockResolvedValue([
      { key: "o/r#8", owner: "o", repo: "r", number: 8, title: "Bad PR", headRef: "feat-8", state: "open", labels: [] },
    ]);
    mockGitHub.fetchPRMergeableStatus.mockResolvedValue({ mergeable: false, mergeableState: "dirty" });

    // Make the rebase command fail
    let callIndex = 0;
    (execFileCb as any).mockImplementation((cmd: string, args: string[], optsOrCb: any, cb?: any) => {
      const callback = typeof optsOrCb === "function" ? optsOrCb : cb;
      callIndex++;
      // Third call is rebase - make it fail
      if (callIndex === 3) {
        callback(new Error("merge conflict"), "", "CONFLICT");
      } else {
        callback(null, "", "");
      }
    });

    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger, sseHub: { broadcast: vi.fn() } } as any);
    await orch.rebaseConflictingPRs("o", "r");

    // Should call rebase --abort
    const abortCall = (execFileCb as any).mock.calls.find(
      (c: any[]) => c[1]?.[0] === "rebase" && c[1]?.[1] === "--abort",
    );
    expect(abortCall).toBeDefined();

    // Should post comment about conflict
    expect(mockGitHub.addComment).toHaveBeenCalledWith(
      "o", "r", 8,
      expect.stringContaining("rebase onto `main` failed"),
    );

    // Should not force push
    const pushCall = (execFileCb as any).mock.calls.find(
      (c: any[]) => c[1]?.[0] === "push",
    );
    expect(pushCall).toBeUndefined();

    // Workspace still cleaned up
    expect(rmSync).toHaveBeenCalled();
  });

  it("cleans up workspace even on unexpected errors", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    mockGitHub.fetchOpenPRs.mockResolvedValue([
      { key: "o/r#9", owner: "o", repo: "r", number: 9, title: "Error PR", headRef: "feat-9", state: "open", labels: [] },
    ]);
    mockGitHub.fetchPRMergeableStatus.mockResolvedValue({ mergeable: false, mergeableState: "dirty" });

    // Make clone fail
    (execFileCb as any).mockImplementation((cmd: string, args: string[], optsOrCb: any, cb?: any) => {
      const callback = typeof optsOrCb === "function" ? optsOrCb : cb;
      callback(new Error("network error"), "", "");
    });

    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger, sseHub: { broadcast: vi.fn() } } as any);

    // Should throw because clone fails outside the rebase try/catch
    await expect(orch.rebaseConflictingPRs("o", "r")).rejects.toThrow("network error");

    // Workspace still cleaned up via finally
    expect(rmSync).toHaveBeenCalled();
  });

  it("skips rebase when no token is available", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    const configNoToken = { ...mockConfig, github: { ...mockConfig.github, token: undefined } };
    // Also ensure no env var
    const origEnv = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    const orch = new Orchestrator(configNoToken as any, mockGitHub as any, { config: configNoToken, github: mockGitHub, logger: mockLogger, sseHub: { broadcast: vi.fn() } } as any);
    await orch.rebaseConflictingPRs("o", "r");

    expect(mockGitHub.fetchOpenPRs).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith("no GitHub token available, skipping rebase of conflicting PRs");

    process.env.GITHUB_TOKEN = origEnv;
  });

  it("does nothing when no open PRs exist", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    mockGitHub.fetchOpenPRs.mockResolvedValue([]);

    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger, sseHub: { broadcast: vi.fn() } } as any);
    await orch.rebaseConflictingPRs("o", "r");

    expect(mockGitHub.fetchOpenPRs).toHaveBeenCalledWith("o", "r");
    expect(mockGitHub.fetchPRMergeableStatus).not.toHaveBeenCalled();
    expect(execFileCb).not.toHaveBeenCalled();
  });

  it("logs rebase attempts at info level", async () => {
    const mockGitHub = makeMockGitHub();
    const mockLogger = makeMockLogger();

    mockGitHub.fetchOpenPRs.mockResolvedValue([
      { key: "o/r#3", owner: "o", repo: "r", number: 3, title: "Conflict", headRef: "feat-3", state: "open", labels: [] },
    ]);
    mockGitHub.fetchPRMergeableStatus.mockResolvedValue({ mergeable: false, mergeableState: "dirty" });

    // Reset execFile mock to succeed
    (execFileCb as any).mockImplementation((cmd: string, args: string[], optsOrCb: any, cb?: any) => {
      const callback = typeof optsOrCb === "function" ? optsOrCb : cb;
      callback(null, "", "");
    });

    const orch = new Orchestrator(mockConfig as any, mockGitHub as any, { config: mockConfig, github: mockGitHub, logger: mockLogger, sseHub: { broadcast: vi.fn() } } as any);
    await orch.rebaseConflictingPRs("o", "r");

    // Check info-level logs for rebase attempt and success
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "o", repo: "r", prNumber: 3, branch: "feat-3" }),
      "rebasing conflicting PR",
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "o", repo: "r", prNumber: 3 }),
      "successfully rebased and pushed PR",
    );
  });
});
