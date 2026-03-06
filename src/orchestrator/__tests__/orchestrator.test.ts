import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../orchestrator.js";

const mockGitHub = {
  fetchIssues: vi.fn().mockResolvedValue([]),
  addLabel: vi.fn().mockResolvedValue(undefined),
  removeLabel: vi.fn().mockResolvedValue(undefined),
  issueKey: (o: string, r: string, n: number) => `${o}/${r}#${n}`,
  parseIssueKey: (key: string) => {
    const match = key.match(/^(.+)\/(.+)#(\d+)$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
  },
};

const mockConfig = {
  github: { repos: [{ owner: "o", repo: "r", labels: ["oneagent"] }] },
  agent: { provider: "claude-code", stallTimeout: 300000, maxRetries: 3, retryBaseDelay: 60000 },
  concurrency: { max: 3 },
  poll: { interval: 30000, reconcileInterval: 15000 },
  labels: { eligible: "oneagent", inProgress: "oneagent-working", failed: "oneagent-failed" },
  workspace: { baseDir: "/tmp/test-ws", hooks: {} },
  web: { port: 3000, enabled: false },
  project: { statuses: { todo: "Todo", inProgress: "In Progress", inReview: "In Review", done: "Done" } },
};

describe("Orchestrator", () => {
  it("can be constructed", () => {
    const orch = new Orchestrator(mockConfig as any, mockGitHub as any);
    expect(orch).toBeDefined();
  });

  it("tick fetches issues from all repos", async () => {
    const orch = new Orchestrator(mockConfig as any, mockGitHub as any);
    await orch.tick();
    expect(mockGitHub.fetchIssues).toHaveBeenCalledWith("o", "r", "oneagent");
  });
});
