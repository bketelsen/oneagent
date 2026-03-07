# PR Review Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated PR review agent that independently reviews PRs with its own model, submits GitHub PR reviews, and can optionally merge approved PRs.

**Architecture:** New `pr-reviewer` agent dispatched by the orchestrator after coder runs complete. The review agent submits GitHub PR reviews (approve/request-changes). On request-changes, the existing review iteration flow kicks in — the coder addresses feedback, then the reviewer re-reviews. After max cycles, escalate to human. Auto-merge is opt-in and gated by CI checks.

**Tech Stack:** TypeScript, Vitest, Zod v4, Octokit, one-agent-sdk

---

### Task 1: Expand Config Schema

**Files:**
- Modify: `src/config/schema.ts:66-69` (prReviewSchema)
- Modify: `src/config/__tests__/schema.test.ts:98-134` (prReview tests)

**Step 1: Write failing tests for new prReview config fields**

Add to the existing `prReview config` describe block in `src/config/__tests__/schema.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: FAIL — properties `provider`, `autoMerge`, `maxReviewCycles`, `requireChecks` don't exist on prReview type

**Step 3: Add new fields to prReviewSchema**

In `src/config/schema.ts`, replace lines 66-69:

```typescript
const prReviewSchema = z.object({
  enabled: z.boolean().default(true),
  pollInterval: z.number().min(5000).default(60000),
  provider: z.string().default("claude-code"),
  model: z.string().optional(),
  autoMerge: z.boolean().default(false),
  maxReviewCycles: z.number().min(1).default(2),
  requireChecks: z.boolean().default(true),
});
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/schema.ts src/config/__tests__/schema.test.ts
git commit -m "feat: expand prReview config with provider, model, autoMerge, maxReviewCycles"
```

---

### Task 2: Add GitHub Client Methods (submitPRReview, mergePR, allChecksPassed)

**Files:**
- Modify: `src/github/client.ts:244-254` (add after fetchCheckRuns)
- Modify: `src/github/__tests__/client.test.ts` (add new describe blocks)

**Step 1: Write failing tests for submitPRReview**

Add to `src/github/__tests__/client.test.ts`:

```typescript
describe("submitPRReview", () => {
  it("submits an APPROVE review", async () => {
    const client = new GitHubClient("fake-token");
    const createReview = vi.fn().mockResolvedValue({ data: {} });
    (client as any).octokit = {
      rest: { pulls: { createReview } },
    };

    await client.submitPRReview("owner", "repo", 10, "APPROVE", "Looks good!");
    expect(createReview).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      pull_number: 10,
      event: "APPROVE",
      body: "Looks good!",
      comments: undefined,
    });
  });

  it("submits a REQUEST_CHANGES review with inline comments", async () => {
    const client = new GitHubClient("fake-token");
    const createReview = vi.fn().mockResolvedValue({ data: {} });
    (client as any).octokit = {
      rest: { pulls: { createReview } },
    };

    const comments = [{ path: "src/index.ts", line: 10, body: "Fix this" }];
    await client.submitPRReview("owner", "repo", 10, "REQUEST_CHANGES", "Needs work", comments);
    expect(createReview).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      pull_number: 10,
      event: "REQUEST_CHANGES",
      body: "Needs work",
      comments,
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/github/__tests__/client.test.ts -t "submitPRReview"`
Expected: FAIL — `client.submitPRReview is not a function`

**Step 3: Implement submitPRReview**

Add to `src/github/client.ts` after `fetchCheckRuns` (after line 253):

```typescript
async submitPRReview(
  owner: string,
  repo: string,
  prNumber: number,
  event: "APPROVE" | "REQUEST_CHANGES",
  body: string,
  comments?: Array<{ path: string; line: number; body: string }>,
): Promise<void> {
  await this.octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    event,
    body,
    comments,
  });
  this.logger.debug({ owner, repo, prNumber, event }, "submitted PR review");
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/github/__tests__/client.test.ts -t "submitPRReview"`
Expected: PASS

**Step 5: Write failing tests for mergePR**

```typescript
describe("mergePR", () => {
  it("merges a PR with squash by default", async () => {
    const client = new GitHubClient("fake-token");
    const merge = vi.fn().mockResolvedValue({ data: {} });
    (client as any).octokit = {
      rest: { pulls: { merge } },
    };

    await client.mergePR("owner", "repo", 10);
    expect(merge).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      pull_number: 10,
      merge_method: "squash",
    });
  });

  it("merges with specified merge method", async () => {
    const client = new GitHubClient("fake-token");
    const merge = vi.fn().mockResolvedValue({ data: {} });
    (client as any).octokit = {
      rest: { pulls: { merge } },
    };

    await client.mergePR("owner", "repo", 10, "rebase");
    expect(merge).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      pull_number: 10,
      merge_method: "rebase",
    });
  });
});
```

**Step 6: Run tests to verify they fail**

Run: `npx vitest run src/github/__tests__/client.test.ts -t "mergePR"`
Expected: FAIL

**Step 7: Implement mergePR**

Add to `src/github/client.ts`:

```typescript
async mergePR(
  owner: string,
  repo: string,
  prNumber: number,
  mergeMethod: "squash" | "merge" | "rebase" = "squash",
): Promise<void> {
  await this.octokit.rest.pulls.merge({
    owner,
    repo,
    pull_number: prNumber,
    merge_method: mergeMethod,
  });
  this.logger.debug({ owner, repo, prNumber, mergeMethod }, "merged PR");
}
```

**Step 8: Run tests to verify they pass**

Run: `npx vitest run src/github/__tests__/client.test.ts -t "mergePR"`
Expected: PASS

**Step 9: Write failing tests for allChecksPassed**

```typescript
describe("allChecksPassed", () => {
  function createMockClientForChecks(checkRuns: any[]) {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        checks: {
          listForRef: vi.fn().mockResolvedValue({
            data: { check_runs: checkRuns },
          }),
        },
      },
    };
    return client;
  }

  it("returns true when all checks completed successfully", async () => {
    const client = createMockClientForChecks([
      { id: 1, name: "build", status: "completed", conclusion: "success" },
      { id: 2, name: "test", status: "completed", conclusion: "success" },
    ]);
    expect(await client.allChecksPassed("owner", "repo", "abc123")).toBe(true);
  });

  it("returns false when any check failed", async () => {
    const client = createMockClientForChecks([
      { id: 1, name: "build", status: "completed", conclusion: "success" },
      { id: 2, name: "test", status: "completed", conclusion: "failure" },
    ]);
    expect(await client.allChecksPassed("owner", "repo", "abc123")).toBe(false);
  });

  it("returns false when any check is still in progress", async () => {
    const client = createMockClientForChecks([
      { id: 1, name: "build", status: "completed", conclusion: "success" },
      { id: 2, name: "test", status: "in_progress", conclusion: null },
    ]);
    expect(await client.allChecksPassed("owner", "repo", "abc123")).toBe(false);
  });

  it("returns true when there are no check runs", async () => {
    const client = createMockClientForChecks([]);
    expect(await client.allChecksPassed("owner", "repo", "abc123")).toBe(true);
  });
});
```

**Step 10: Run tests to verify they fail**

Run: `npx vitest run src/github/__tests__/client.test.ts -t "allChecksPassed"`
Expected: FAIL

**Step 11: Implement allChecksPassed**

Add to `src/github/client.ts`:

```typescript
async allChecksPassed(owner: string, repo: string, ref: string): Promise<boolean> {
  const checks = await this.fetchCheckRuns(owner, repo, ref);
  return checks.every((c) => c.status === "completed" && c.conclusion === "success");
}
```

**Step 12: Run all GitHub client tests**

Run: `npx vitest run src/github/__tests__/client.test.ts`
Expected: PASS

**Step 13: Commit**

```bash
git add src/github/client.ts src/github/__tests__/client.test.ts
git commit -m "feat: add submitPRReview, mergePR, allChecksPassed to GitHubClient"
```

---

### Task 3: Define the PR Reviewer Agent

**Files:**
- Create: `src/agents/skills/pr-reviewer.ts`
- Modify: `src/agents/prompts.ts:62` (add PR_REVIEWER_PROMPT after PLANNER_PROMPT)
- Modify: `src/agents/graph.ts` (register pr-reviewer in agent graph)
- Modify: `src/agents/__tests__/graph.test.ts` (add pr-reviewer assertions)

**Step 1: Write failing test for pr-reviewer in agent graph**

Add to `src/agents/__tests__/graph.test.ts`:

```typescript
it("includes the pr-reviewer agent", () => {
  const graph = buildAgentGraph();
  expect(graph.has("pr-reviewer")).toBe(true);
});

it("pr-reviewer has no handoffs", () => {
  const graph = buildAgentGraph();
  const prReviewer = graph.get("pr-reviewer")!;
  expect(prReviewer.handoffs).toEqual([]);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/agents/__tests__/graph.test.ts`
Expected: FAIL — `pr-reviewer` not in graph

**Step 3: Add PR_REVIEWER_PROMPT to prompts.ts**

Add after `PLANNER_PROMPT` in `src/agents/prompts.ts` (after line 72):

```typescript
export const PR_REVIEWER_PROMPT = `You are a senior code reviewer. Your job is to independently review pull requests.

Review the PR diff thoroughly for:
1. Correctness — logic errors, off-by-one bugs, missing edge cases
2. Security — injection, auth bypass, data exposure (OWASP top 10)
3. Test coverage — are new/changed paths tested?
4. Error handling — are failures handled gracefully?
5. Consistency — does the code follow existing codebase patterns?

After reviewing, submit a GitHub PR review:
- APPROVE if the code is correct, secure, and well-tested
- REQUEST_CHANGES if there are issues, with specific inline comments explaining what to fix and why

Do NOT nitpick:
- Style issues that don't affect correctness
- Subjective preferences about naming or formatting
- Minor documentation gaps

Be constructive and specific. Every comment should be actionable.`;
```

**Step 4: Create pr-reviewer agent definition**

Create `src/agents/skills/pr-reviewer.ts`:

```typescript
import { defineAgent } from "one-agent-sdk";
import { PR_REVIEWER_PROMPT } from "../prompts.js";

export const prReviewerAgent = defineAgent({
  name: "pr-reviewer",
  description: "Independent PR reviewer that submits GitHub reviews",
  prompt: PR_REVIEWER_PROMPT,
  handoffs: [],
});
```

**Step 5: Register in agent graph**

In `src/agents/graph.ts`, add import at line 6:

```typescript
import { prReviewerAgent } from "./skills/pr-reviewer.js";
```

Add `prReviewerAgent` to the agents array (after `plannerAgent` in the array at line 33):

```typescript
const agents: AgentDef[] = [
  coderAgent,
  tddAgent,
  debuggerAgent,
  reviewerAgent,
  prWorkflowAgent,
  plannerAgent,
  prReviewerAgent,
];
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/agents/__tests__/graph.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/agents/prompts.ts src/agents/skills/pr-reviewer.ts src/agents/graph.ts src/agents/__tests__/graph.test.ts
git commit -m "feat: add pr-reviewer agent with independent review prompt"
```

---

### Task 4: Add Review Dispatch Prompt to Dispatcher

**Files:**
- Modify: `src/orchestrator/dispatcher.ts` (add `buildReviewDispatchPrompt`)
- Modify: `src/orchestrator/__tests__/dispatcher.test.ts` (add tests)

**Step 1: Write failing tests**

Add to `src/orchestrator/__tests__/dispatcher.test.ts`:

```typescript
it("builds a review dispatch prompt for the pr-reviewer agent", () => {
  const dispatcher = new Dispatcher();
  const prompt = dispatcher.buildReviewDispatchPrompt(
    {
      key: "o/r#10",
      owner: "o",
      repo: "r",
      number: 10,
      title: "Add feature",
      headRef: "feature-branch",
      state: "open",
      labels: ["oneagent"],
    },
    "+added line\n-removed line",
  );
  expect(prompt).toContain("PR Review: o/r#10");
  expect(prompt).toContain("Add feature");
  expect(prompt).toContain("feature-branch");
  expect(prompt).toContain("+added line");
  expect(prompt).toContain("APPROVE");
  expect(prompt).toContain("REQUEST_CHANGES");
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/orchestrator/__tests__/dispatcher.test.ts -t "review dispatch"`
Expected: FAIL

**Step 3: Implement buildReviewDispatchPrompt**

Add to `src/orchestrator/dispatcher.ts`:

```typescript
buildReviewDispatchPrompt(pr: PullRequest, diff: string): string {
  return `## PR Review: ${pr.key}

**PR Title:** ${pr.title}
**Branch:** ${pr.headRef}
**Repository:** ${pr.owner}/${pr.repo}
**PR Number:** #${pr.number}

**Diff to review:**
\`\`\`diff
${diff}
\`\`\`

Review this pull request. After your review:
- If the code is correct, secure, and well-tested: submit an APPROVE review
- If changes are needed: submit a REQUEST_CHANGES review with specific inline comments

Use the GitHub API to submit your review on PR #${pr.number} in ${pr.owner}/${pr.repo}.`;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/orchestrator/__tests__/dispatcher.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator/dispatcher.ts src/orchestrator/__tests__/dispatcher.test.ts
git commit -m "feat: add buildReviewDispatchPrompt for pr-reviewer agent"
```

---

### Task 5: Add Review Cycle State Tracking

**Files:**
- Modify: `src/orchestrator/state.ts` (add ReviewCycleState)
- Create: `src/orchestrator/__tests__/review-cycle.test.ts`

**Step 1: Write failing tests**

Create `src/orchestrator/__tests__/review-cycle.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ReviewCycleState } from "../state.js";

describe("ReviewCycleState", () => {
  it("returns 0 for unknown PR keys", () => {
    const state = new ReviewCycleState();
    expect(state.getCycleCount("owner/repo#10")).toBe(0);
  });

  it("increments cycle count", () => {
    const state = new ReviewCycleState();
    state.increment("owner/repo#10");
    expect(state.getCycleCount("owner/repo#10")).toBe(1);
    state.increment("owner/repo#10");
    expect(state.getCycleCount("owner/repo#10")).toBe(2);
  });

  it("checks if max cycles exceeded", () => {
    const state = new ReviewCycleState();
    state.increment("owner/repo#10");
    state.increment("owner/repo#10");
    expect(state.isExhausted("owner/repo#10", 2)).toBe(true);
    expect(state.isExhausted("owner/repo#10", 3)).toBe(false);
  });

  it("resets cycle count for a PR", () => {
    const state = new ReviewCycleState();
    state.increment("owner/repo#10");
    state.increment("owner/repo#10");
    state.reset("owner/repo#10");
    expect(state.getCycleCount("owner/repo#10")).toBe(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/orchestrator/__tests__/review-cycle.test.ts`
Expected: FAIL — `ReviewCycleState` not exported

**Step 3: Implement ReviewCycleState**

Add to `src/orchestrator/state.ts` (after the `RunState` class):

```typescript
export class ReviewCycleState {
  private cycles = new Map<string, number>();

  getCycleCount(prKey: string): number {
    return this.cycles.get(prKey) ?? 0;
  }

  increment(prKey: string): void {
    this.cycles.set(prKey, this.getCycleCount(prKey) + 1);
  }

  isExhausted(prKey: string, maxCycles: number): boolean {
    return this.getCycleCount(prKey) >= maxCycles;
  }

  reset(prKey: string): void {
    this.cycles.delete(prKey);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/orchestrator/__tests__/review-cycle.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator/state.ts src/orchestrator/__tests__/review-cycle.test.ts
git commit -m "feat: add ReviewCycleState for tracking review-fix cycle counts"
```

---

### Task 6: Add Labels Config for Review States

**Files:**
- Modify: `src/config/schema.ts:71-75` (labelsSchema)
- Modify: `src/config/__tests__/schema.test.ts`

**Step 1: Write failing tests**

Add to `src/config/__tests__/schema.test.ts`:

```typescript
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
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/config/__tests__/schema.test.ts -t "labels config"`
Expected: FAIL

**Step 3: Add new labels to labelsSchema**

In `src/config/schema.ts`, update `labelsSchema` (lines 71-75):

```typescript
const labelsSchema = z.object({
  eligible: z.string().default("oneagent"),
  inProgress: z.string().default("oneagent-working"),
  failed: z.string().default("oneagent-failed"),
  needsReview: z.string().default("oneagent-needs-review"),
  needsHuman: z.string().default("oneagent-needs-human"),
});
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/schema.ts src/config/__tests__/schema.test.ts
git commit -m "feat: add needsReview and needsHuman labels to config schema"
```

---

### Task 7: Wire Review Dispatch into Orchestrator

**Files:**
- Modify: `src/orchestrator/orchestrator.ts` (add review dispatch after coder completion, review completion handler)

This is the largest task. The orchestrator needs three new capabilities:

1. After a coder run completes → check for PR → dispatch review agent
2. After a review-fix run completes → re-dispatch review agent (if under max cycles)
3. After a review agent completes → check verdict → merge or escalate

**Step 1: Add imports and state**

In `src/orchestrator/orchestrator.ts`, add imports:

```typescript
import { prReviewerAgent } from "../agents/skills/pr-reviewer.js";
import { ReviewCycleState } from "./state.js";
```

Add to `Orchestrator` class properties (after `private logger: Logger;` at line 47):

```typescript
readonly reviewCycles = new ReviewCycleState();
```

**Step 2: Add helper to find PR for a completed issue run**

The orchestrator needs to find an open PR created by the coder for the issue. Add a private method:

```typescript
private async findPRForIssue(issueKey: string): Promise<PullRequest | null> {
  const parsed = this.github.parseIssueKey(issueKey);
  if (!parsed) return null;

  const prs = await this.github.fetchOpenPRs(parsed.owner, parsed.repo);
  // Find a PR whose body links to this issue
  for (const pr of prs) {
    // PRs created by the coder agent typically reference the issue
    if (pr.labels.includes(this.config.labels.inProgress)) {
      return pr;
    }
  }
  return null;
}
```

**Step 3: Add dispatchReview method**

```typescript
private async dispatchReview(pr: PullRequest): Promise<void> {
  const prRunKey = `pr-agent-review:${pr.key}`;
  if (this.state.isRunning(prRunKey)) return;

  const runId = ulid();
  const abortController = new AbortController();

  // Add needs-review label
  await this.github.addLabel(pr.owner, pr.repo, pr.number, this.config.labels.needsReview);

  const diff = await this.github.fetchPRDiff(pr.owner, pr.repo, pr.number);
  const prompt = this.dispatcher.buildReviewDispatchPrompt(pr, diff);

  const entry: RunEntry = {
    runId,
    issueKey: prRunKey,
    provider: this.config.prReview.provider,
    model: this.config.prReview.model,
    startedAt: new Date(),
    lastActivity: new Date(),
    retryCount: 0,
    abortController,
    currentAgent: "pr-reviewer",
    lastActivityDescription: "Starting review...",
    toolCallCount: 0,
  };

  this.state.add(prRunKey, entry);
  this.logger.info({ runId, prKey: pr.key }, "dispatching PR review agent");

  this.deps.runsRepo?.insert({
    id: runId,
    issueKey: prRunKey,
    provider: entry.provider,
    model: entry.model,
    status: "running",
    startedAt: entry.startedAt.toISOString(),
    retryCount: 0,
  });

  this.sseHub.emit("sse", {
    type: "agent:started",
    data: { runId, issueKey: prRunKey, provider: entry.provider },
  });

  this.executeReviewAgentRun(runId, prRunKey, pr, prompt, abortController).catch((err) => {
    this.logger.error({ err, runId, prKey: pr.key }, "unhandled review agent error");
  });
}
```

**Step 4: Add executeReviewAgentRun method**

This is similar to `executeReviewRun` but uses the `prReviewerAgent` and handles the verdict:

```typescript
private async executeReviewAgentRun(
  runId: string,
  prRunKey: string,
  pr: PullRequest,
  prompt: string,
  abortController: AbortController,
): Promise<void> {
  const stallDetector = createStallDetector(this.config.agent.stallTimeout, () => {
    this.logger.warn({ runId, prRunKey }, "review agent stalled, aborting");
    abortController.abort();
  });

  try {
    const runConfig: RunConfig = {
      provider: this.config.prReview.provider as any,
      agent: prReviewerAgent as any,
      agents: this.agentMap as any,
      signal: abortController.signal,
    };

    const agentRun = await run(prompt, runConfig);
    stallDetector.start();

    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for await (const chunk of agentRun.stream) {
      stallDetector.activity();
      this.state.updateActivity(prRunKey);

      const entry = this.state.get(prRunKey);
      if (entry) {
        if (chunk.type === "tool_call") {
          const toolChunk = chunk as unknown as { toolName?: string };
          entry.lastActivityDescription = `Called ${toolChunk.toolName ?? "unknown"}`;
          entry.toolCallCount++;
        } else if (chunk.type === "text") {
          const textChunk = chunk as unknown as { content?: string };
          const content = textChunk.content ?? "";
          entry.lastActivityDescription = content.length > 80 ? content.slice(0, 80) : (content || "Reviewing...");
        }
      }

      this.sseHub.emit("sse", {
        type: `agent:${chunk.type}`,
        data: { runId, ...chunk },
      });

      this.deps.eventsRepo?.insert(runId, chunk.type, chunk as unknown as Record<string, unknown>);

      if (chunk.type === "done" && chunk.usage) {
        totalInputTokens += chunk.usage.inputTokens;
        totalOutputTokens += chunk.usage.outputTokens;
      }
    }

    stallDetector.stop();

    const durationMs = Date.now() - (this.state.get(prRunKey)?.startedAt.getTime() ?? Date.now());
    this.state.remove(prRunKey);
    this.deps.runsRepo?.completeRun(runId, "completed", new Date().toISOString(), durationMs);
    this.logger.info({ runId, prRunKey, durationMs }, "review agent run completed");

    if (totalInputTokens > 0 || totalOutputTokens > 0) {
      this.deps.metricsRepo?.record({
        runId,
        provider: this.config.prReview.provider,
        tokensIn: totalInputTokens,
        tokensOut: totalOutputTokens,
        durationMs,
      });
    }

    this.sseHub.emit("sse", {
      type: "agent:completed",
      data: { runId, issueKey: prRunKey },
    });

    // Handle post-review: check if the agent approved or requested changes
    await this.onReviewComplete(pr);

  } catch (err) {
    stallDetector.stop();
    this.state.remove(prRunKey);

    const errorMsg = err instanceof Error ? err.message : String(err);
    this.deps.runsRepo?.completeRun(runId, "failed", new Date().toISOString(), 0, errorMsg);
    this.logger.error({ err, runId, prRunKey }, "review agent run failed");

    // Remove needs-review label on failure
    await this.github.removeLabel(pr.owner, pr.repo, pr.number, this.config.labels.needsReview);

    this.sseHub.emit("sse", {
      type: "agent:failed",
      data: { runId, issueKey: prRunKey, error: errorMsg },
    });
  }
}
```

**Step 5: Add onReviewComplete method**

This checks the PR review state and decides next steps:

```typescript
private async onReviewComplete(pr: PullRequest): Promise<void> {
  // Remove the needs-review label
  await this.github.removeLabel(pr.owner, pr.repo, pr.number, this.config.labels.needsReview);

  // Check if the agent left an APPROVE or REQUEST_CHANGES review
  // We inspect the latest review on the PR
  const reviews = await this.github.fetchPRReviews(pr.owner, pr.repo, pr.number);
  const latestReview = reviews[0]; // Most recent

  if (!latestReview || latestReview.state === "APPROVED") {
    this.logger.info({ prKey: pr.key }, "PR approved by review agent");
    this.reviewCycles.reset(pr.key);

    if (this.config.prReview.autoMerge) {
      await this.tryAutoMerge(pr);
    }
  } else if (latestReview.state === "CHANGES_REQUESTED") {
    this.reviewCycles.increment(pr.key);
    const cycleCount = this.reviewCycles.getCycleCount(pr.key);

    if (this.reviewCycles.isExhausted(pr.key, this.config.prReview.maxReviewCycles)) {
      this.logger.warn({ prKey: pr.key, cycleCount }, "max review cycles reached, escalating to human");
      await this.github.addLabel(pr.owner, pr.repo, pr.number, this.config.labels.needsHuman);
      this.reviewCycles.reset(pr.key);
    } else {
      this.logger.info({ prKey: pr.key, cycleCount }, "review requested changes, waiting for coder to address");
      // Add inProgress label so tickReviewFeedback picks up the review comments
      await this.github.addLabel(pr.owner, pr.repo, pr.number, this.config.labels.inProgress);
    }
  }
}
```

**Step 6: Add tryAutoMerge method**

```typescript
private async tryAutoMerge(pr: PullRequest): Promise<void> {
  if (!this.config.prReview.requireChecks) {
    await this.github.mergePR(pr.owner, pr.repo, pr.number);
    this.logger.info({ prKey: pr.key }, "auto-merged PR (checks not required)");
    return;
  }

  const passed = await this.github.allChecksPassed(pr.owner, pr.repo, pr.headRef);
  if (passed) {
    await this.github.mergePR(pr.owner, pr.repo, pr.number);
    this.logger.info({ prKey: pr.key }, "auto-merged PR (all checks passed)");
  } else {
    this.logger.info({ prKey: pr.key }, "skipping auto-merge: CI checks not all passing");
  }
}
```

**Step 7: Add fetchPRReviews to GitHubClient**

We need one more GitHub client method. Add to `src/github/client.ts`:

```typescript
async fetchPRReviews(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Array<{ id: number; state: string; user: string }>> {
  const { data } = await this.octokit.rest.pulls.listReviews({
    owner,
    repo,
    pull_number: prNumber,
  });
  this.logger.debug({ owner, repo, prNumber, count: data.length }, "fetched PR reviews");
  return data
    .sort((a, b) => new Date(b.submitted_at ?? 0).getTime() - new Date(a.submitted_at ?? 0).getTime())
    .map((r) => ({
      id: r.id,
      state: r.state,
      user: r.user?.login ?? "unknown",
    }));
}
```

**Step 8: Wire into executeRun completion**

In `src/orchestrator/orchestrator.ts`, in the `executeRun` method, after the successful completion block (after line 458, the `rebaseConflictingPRs` call), add:

```typescript
// After successful coder run, dispatch review agent if PR review is enabled
if (this.config.prReview.enabled) {
  const pr = await this.findPRForIssue(issue.key);
  if (pr) {
    this.logger.info({ issueKey: issue.key, prKey: pr.key }, "coder run produced PR, dispatching review");
    await this.dispatchReview(pr).catch((err) => {
      this.logger.error({ err, issueKey: issue.key }, "failed to dispatch review agent");
    });
  }
}
```

**Step 9: Wire into executeReviewRun completion (coder addressing feedback)**

In the `executeReviewRun` method, after the successful completion block (after line 301, the metrics recording), add:

```typescript
// After coder addresses review feedback, re-dispatch review agent
if (this.config.prReview.enabled && prRunKey.startsWith("pr-review:")) {
  const parsed = this.github.parseIssueKey(prRunKey.replace("pr-review:", ""));
  if (parsed) {
    const prs = await this.github.fetchOpenPRs(parsed.owner, parsed.repo);
    const pr = prs.find((p) => p.key === prRunKey.replace("pr-review:", ""));
    if (pr && !this.reviewCycles.isExhausted(pr.key, this.config.prReview.maxReviewCycles)) {
      this.logger.info({ prKey: pr.key }, "coder addressed feedback, re-dispatching review");
      await this.dispatchReview(pr).catch((err) => {
        this.logger.error({ err, prKey: pr.key }, "failed to re-dispatch review agent");
      });
    }
  }
}
```

**Step 10: Compile and run all tests**

Run: `npm run build && npm test`
Expected: Build succeeds, all tests pass

**Step 11: Commit**

```bash
git add src/orchestrator/orchestrator.ts src/github/client.ts
git commit -m "feat: wire review agent dispatch into orchestrator lifecycle"
```

---

### Task 8: Add Manual Review Trigger via Label Polling

**Files:**
- Modify: `src/orchestrator/orchestrator.ts` (add polling for `oneagent-needs-review` label)

**Step 1: Add tickReviewDispatch method**

The orchestrator should also poll for PRs with the `oneagent-needs-review` label (for manual triggering). Add to `Orchestrator`:

```typescript
async tickReviewDispatch(): Promise<void> {
  if (!this.config.prReview.enabled) return;

  for (const repo of this.config.github.repos) {
    const prs = await this.github.fetchPRsWithLabel(
      repo.owner,
      repo.repo,
      this.config.labels.needsReview,
    );

    for (const pr of prs) {
      const prRunKey = `pr-agent-review:${pr.key}`;
      if (this.state.isRunning(prRunKey)) continue;
      if (this.state.activeCount() >= this.config.concurrency.max) break;

      // Only dispatch if not already exhausted
      if (!this.reviewCycles.isExhausted(pr.key, this.config.prReview.maxReviewCycles)) {
        await this.dispatchReview(pr);
      }
    }
  }
}
```

**Step 2: Wire into the start method**

In the `start()` method, add a timer for review dispatch polling (after the existing review timer at line 76):

```typescript
// Also poll for PRs needing review (manual trigger via label)
setInterval(() => this.tickReviewDispatch(), this.config.prReview.pollInterval);
```

Note: `dispatchReview` already removes the label after completion, so this won't re-trigger for the same PR.

**Step 3: Compile and run tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/orchestrator/orchestrator.ts
git commit -m "feat: add manual review trigger via oneagent-needs-review label polling"
```

---

### Task 9: Add fetchPRReviews Tests

**Files:**
- Modify: `src/github/__tests__/client.test.ts`

**Step 1: Write tests for fetchPRReviews**

```typescript
describe("fetchPRReviews", () => {
  it("returns reviews sorted by most recent first", async () => {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        pulls: {
          listReviews: vi.fn().mockResolvedValue({
            data: [
              { id: 1, state: "APPROVED", user: { login: "alice" }, submitted_at: "2026-01-01T00:00:00Z" },
              { id: 2, state: "CHANGES_REQUESTED", user: { login: "bob" }, submitted_at: "2026-01-02T00:00:00Z" },
            ],
          }),
        },
      },
    };

    const reviews = await client.fetchPRReviews("owner", "repo", 10);
    expect(reviews).toHaveLength(2);
    expect(reviews[0].state).toBe("CHANGES_REQUESTED"); // Most recent first
    expect(reviews[1].state).toBe("APPROVED");
  });

  it("handles null user", async () => {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        pulls: {
          listReviews: vi.fn().mockResolvedValue({
            data: [{ id: 1, state: "APPROVED", user: null, submitted_at: "2026-01-01T00:00:00Z" }],
          }),
        },
      },
    };

    const reviews = await client.fetchPRReviews("owner", "repo", 10);
    expect(reviews[0].user).toBe("unknown");
  });

  it("returns empty array when no reviews", async () => {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        pulls: {
          listReviews: vi.fn().mockResolvedValue({ data: [] }),
        },
      },
    };

    const reviews = await client.fetchPRReviews("owner", "repo", 10);
    expect(reviews).toHaveLength(0);
  });
});
```

**Step 2: Run tests**

Run: `npx vitest run src/github/__tests__/client.test.ts -t "fetchPRReviews"`
Expected: PASS (implementation was added in Task 7)

**Step 3: Commit**

```bash
git add src/github/__tests__/client.test.ts
git commit -m "test: add tests for fetchPRReviews"
```

---

### Task 10: Final Integration Test and Documentation

**Files:**
- Modify: `CLAUDE.md` (document new feature)
- Modify: `README.md` (document new feature)

**Step 1: Run full test suite**

Run: `npm run build && npm test`
Expected: All tests pass, build succeeds

**Step 2: Update CLAUDE.md**

Add to the "Orchestrator Features" section in `CLAUDE.md`:

```markdown
- **PR review agent:** After a coder run produces a PR, a dedicated review agent (with its own model/provider from `prReview` config) independently reviews it. Submits GitHub PR reviews (approve/request-changes). On request-changes, the coder addresses feedback, then the reviewer re-reviews. After `maxReviewCycles` (default 2), escalates with `oneagent-needs-human` label. Auto-merge is opt-in (`prReview.autoMerge`) and gated by CI checks.
```

**Step 3: Update README.md**

Add a section documenting the PR review agent feature, config options, and label lifecycle.

**Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document PR review agent feature"
```
