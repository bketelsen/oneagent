# PR Review Comment + Merge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the pr-reviewer agent's formal GitHub review submission with a structured `submit_review` tool that returns the verdict to the orchestrator, which then posts comments and optionally merges.

**Architecture:** A factory function `createReviewTools()` creates a `submit_review` tool with a closure-captured result. The orchestrator passes this tool to the pr-reviewer agent, reads the captured verdict after the run completes, and takes action (post comment + optional merge, or post COMMENT review with inline feedback).

**Tech Stack:** TypeScript, one-agent-sdk (`defineTool`, `AgentDef.tools`), Zod v4, Vitest

---

### Task 1: Create the `submit_review` tool

**Files:**
- Create: `src/tools/review.ts`
- Modify: `src/tools/index.ts`

**Step 1: Write the failing test**

Create `src/tools/__tests__/review.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createReviewTools } from "../review.js";

describe("review tools", () => {
  it("submit_review captures approve verdict", async () => {
    const { submitReview, getVerdict } = createReviewTools();

    const result = await submitReview.handler({
      verdict: "approve",
      summary: "LGTM, clean implementation",
    });

    expect(result).toContain("recorded");
    const verdict = getVerdict();
    expect(verdict).toEqual({
      verdict: "approve",
      summary: "LGTM, clean implementation",
      comments: undefined,
    });
  });

  it("submit_review captures request_changes verdict with comments", async () => {
    const { submitReview, getVerdict } = createReviewTools();

    await submitReview.handler({
      verdict: "request_changes",
      summary: "Found issues",
      comments: [
        { path: "src/foo.ts", line: 10, body: "Missing null check" },
      ],
    });

    const verdict = getVerdict();
    expect(verdict).toEqual({
      verdict: "request_changes",
      summary: "Found issues",
      comments: [{ path: "src/foo.ts", line: 10, body: "Missing null check" }],
    });
  });

  it("getVerdict returns null before tool is called", () => {
    const { getVerdict } = createReviewTools();
    expect(getVerdict()).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/__tests__/review.test.ts`
Expected: FAIL — module `../review.js` not found

**Step 3: Write minimal implementation**

Create `src/tools/review.ts`:

```typescript
import { defineTool } from "one-agent-sdk";
import { z } from "zod";

export interface ReviewVerdict {
  verdict: "approve" | "request_changes";
  summary: string;
  comments?: Array<{ path: string; line: number; body: string }>;
}

export function createReviewTools() {
  let captured: ReviewVerdict | null = null;

  const submitReview = defineTool({
    name: "submit_review",
    description:
      "Submit your review verdict. Use 'approve' if the code is correct, secure, and well-tested. Use 'request_changes' if there are issues, with specific inline comments.",
    parameters: z.object({
      verdict: z.enum(["approve", "request_changes"]),
      summary: z.string().describe("Overall review summary"),
      comments: z
        .array(
          z.object({
            path: z.string().describe("File path relative to repo root"),
            line: z.number().describe("Line number"),
            body: z.string().describe("Comment explaining the issue and how to fix it"),
          }),
        )
        .optional()
        .describe("Inline comments for request_changes"),
    }),
    handler: async (params) => {
      captured = {
        verdict: params.verdict,
        summary: params.summary,
        comments: params.comments,
      };
      return `Review verdict recorded: ${params.verdict}`;
    },
  });

  const getVerdict = (): ReviewVerdict | null => captured;

  return { submitReview, getVerdict };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/__tests__/review.test.ts`
Expected: PASS (3 tests)

**Step 5: Export from index**

In `src/tools/index.ts`, add:

```typescript
export { createReviewTools } from "./review.js";
export type { ReviewVerdict } from "./review.js";
```

**Step 6: Commit**

```bash
git add src/tools/review.ts src/tools/__tests__/review.test.ts src/tools/index.ts
git commit -m "feat: add submit_review tool for pr-reviewer agent"
```

---

### Task 2: Update the pr-reviewer agent to use the tool

**Files:**
- Modify: `src/agents/prompts.ts:105-123`
- Modify: `src/agents/skills/pr-reviewer.ts`

**Step 1: Update the prompt**

In `src/agents/prompts.ts`, replace the `PR_REVIEWER_PROMPT` constant (lines 105-123):

```typescript
export const PR_REVIEWER_PROMPT = `You are a senior code reviewer. Your job is to independently review pull requests.

Review the PR diff thoroughly for:
1. Correctness — logic errors, off-by-one bugs, missing edge cases
2. Security — injection, auth bypass, data exposure (OWASP top 10)
3. Test coverage — are new/changed paths tested?
4. Error handling — are failures handled gracefully?
5. Consistency — does the code follow existing codebase patterns?

After reviewing, use the submit_review tool to record your verdict:
- verdict "approve" if the code is correct, secure, and well-tested
- verdict "request_changes" if there are issues, with specific inline comments explaining what to fix and why

Do NOT nitpick:
- Style issues that don't affect correctness
- Subjective preferences about naming or formatting
- Minor documentation gaps

Be constructive and specific. Every comment should be actionable.`;
```

**Step 2: Remove `defineAgent` from pr-reviewer (it will be created dynamically)**

In `src/agents/skills/pr-reviewer.ts`, change to export just the prompt-based config since the agent now needs tools injected:

```typescript
import type { AgentDef } from "one-agent-sdk";
import { PR_REVIEWER_PROMPT } from "../prompts.js";

/** Base pr-reviewer agent definition (tools added at dispatch time) */
export const prReviewerAgent: AgentDef = {
  name: "pr-reviewer",
  description: "Independent PR reviewer that submits structured review verdicts",
  prompt: PR_REVIEWER_PROMPT,
  handoffs: [],
};
```

Note: `defineAgent` just returns the object — check that `AgentDef` from `one-agent-sdk` is the right type. If `defineAgent` adds runtime behavior, keep using it and add `tools` to the call.

**Step 3: Verify the agent graph test still passes**

Run: `npx vitest run src/agents/__tests__/graph.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/agents/prompts.ts src/agents/skills/pr-reviewer.ts
git commit -m "feat: update pr-reviewer prompt to use submit_review tool"
```

---

### Task 3: Wire the tool into the orchestrator's review dispatch

**Files:**
- Modify: `src/orchestrator/orchestrator.ts` (lines 553-697, 699-725)

**Step 1: Import the review tools**

At top of `src/orchestrator/orchestrator.ts`, add:

```typescript
import { createReviewTools, type ReviewVerdict } from "../tools/review.js";
```

**Step 2: Update `dispatchReview` to create review tools and pass to agent**

In the `dispatchReview` method (around line 553), create the review tools and store `getVerdict` for later:

Add a Map field to the class to track pending review verdicts:

```typescript
private reviewVerdicts = new Map<string, () => ReviewVerdict | null>();
```

In `dispatchReview`, before creating `runConfig`:

```typescript
const { submitReview, getVerdict } = createReviewTools();
this.reviewVerdicts.set(prRunKey, getVerdict);
```

**Step 3: Update `executeReviewAgentRun` to pass tools to the agent**

In `executeReviewAgentRun` (around line 615), modify the `runConfig` to include tools on the agent:

```typescript
const runConfig: RunConfig = {
  provider: this.config.prReview.provider as any,
  agent: {
    ...prReviewerAgent,
    tools: [submitReview],
  } as any,
  agents: this.agentMap as any,
  signal: abortController.signal,
};
```

Pass `submitReview` as a parameter to `executeReviewAgentRun` (update the method signature to accept it).

**Step 4: Update `onReviewComplete` to use captured verdict**

Replace the current `onReviewComplete` method (lines 699-725):

```typescript
private async onReviewComplete(pr: PullRequest): Promise<void> {
  const prRunKey = `pr-agent-review:${pr.key}`;
  await this.github.removeLabel(pr.owner, pr.repo, pr.number, this.config.labels.needsReview);

  const getVerdict = this.reviewVerdicts.get(prRunKey);
  const verdict = getVerdict?.() ?? null;
  this.reviewVerdicts.delete(prRunKey);

  if (!verdict || verdict.verdict === "approve") {
    this.logger.info({ prKey: pr.key }, "PR approved by review agent");
    this.reviewCycles.reset(pr.key);

    // Post approving comment
    if (verdict) {
      await this.github.addComment(pr.owner, pr.repo, pr.number, verdict.summary);
    }

    if (this.config.prReview.autoMerge) {
      await this.tryAutoMerge(pr);
    }
  } else if (verdict.verdict === "request_changes") {
    // Submit as COMMENT review (not REQUEST_CHANGES) with inline comments
    await this.github.submitPRReview(
      pr.owner,
      pr.repo,
      pr.number,
      "COMMENT",
      verdict.summary,
      verdict.comments,
    );

    this.reviewCycles.increment(pr.key);
    const cycleCount = this.reviewCycles.getCycleCount(pr.key);

    if (this.reviewCycles.isExhausted(pr.key, this.config.prReview.maxReviewCycles)) {
      this.logger.warn({ prKey: pr.key, cycleCount }, "max review cycles reached, escalating to human");
      await this.github.addLabel(pr.owner, pr.repo, pr.number, this.config.labels.needsHuman);
      this.reviewCycles.reset(pr.key);
    } else {
      this.logger.info({ prKey: pr.key, cycleCount }, "review requested changes, waiting for coder to address");
      await this.github.addLabel(pr.owner, pr.repo, pr.number, this.config.labels.inProgress);
    }
  }
}
```

**Step 5: Update `submitPRReview` type to accept `"COMMENT"`**

In `src/github/client.ts` line 259, change the event type:

```typescript
event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
```

**Step 6: Run existing orchestrator tests**

Run: `npx vitest run src/orchestrator/__tests__/orchestrator.test.ts`
Expected: Some tests may need updating since `onReviewComplete` no longer calls `fetchPRReviews`.

**Step 7: Update orchestrator tests for the new flow**

Update any tests that mock `fetchPRReviews` for the review completion path. The new flow uses `reviewVerdicts` map instead. Key changes:
- Tests that verify "approve" behavior should set up a verdict via `reviewVerdicts`
- Tests that verify "request_changes" should verify `submitPRReview` is called with `"COMMENT"` event
- Tests that verify "approve" should verify `addComment` is called with the summary

**Step 8: Run all tests**

Run: `npx vitest run`
Expected: PASS

**Step 9: Commit**

```bash
git add src/orchestrator/orchestrator.ts src/github/client.ts src/orchestrator/__tests__/orchestrator.test.ts
git commit -m "feat: wire submit_review tool into orchestrator review flow"
```

---

### Task 4: Verify end-to-end and clean up

**Files:**
- Modify: `CLAUDE.md` (update architecture notes)

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Build check**

Run: `npm run build`
Expected: No type errors

**Step 3: Update CLAUDE.md**

Add to the architecture section under "Agent graph":

> The `pr-reviewer` agent uses a `submit_review` tool (created via `createReviewTools()` factory) to return structured verdicts to the orchestrator. On approval, the orchestrator posts a PR comment and optionally merges. On request-changes, it submits a `COMMENT` review with inline feedback.

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update architecture notes for review tool flow"
```
