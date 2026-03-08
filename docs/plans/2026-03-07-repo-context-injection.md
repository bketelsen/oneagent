# Repo Context Prompt Injection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Inject repository context (instructions + skills) directly into every agent's prompt instead of relying on agents calling the `discover_repo_context` tool.

**Architecture:** The `Dispatcher` gains an optional `repoContext` field. A new `setRepoContext(ctx: string)` method stores it. All `build*Prompt` methods append the context to the prompt. The orchestrator calls `discoverRepoContext(workDir)` once when a workspace is available and passes it to the dispatcher. The coder prompt's "MUST call discover_repo_context" instruction is removed (the tool stays available as a fallback).

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Add repo context to Dispatcher

**Files:**
- Modify: `src/orchestrator/dispatcher.ts`
- Test: `src/orchestrator/__tests__/dispatcher.test.ts`

**Step 1: Write the failing tests**

Add tests to `dispatcher.test.ts`:

```typescript
it("appends repo context to issue prompt when set", () => {
  const dispatcher = new Dispatcher();
  dispatcher.setRepoContext("## Custom Skill: pr-format\nUse conventional commits");
  const prompt = dispatcher.buildPrompt({
    key: "o/r#1",
    owner: "o",
    repo: "r",
    number: 1,
    title: "Fix the bug",
    body: "The button is broken",
    labels: ["oneagent"],
    state: "open",
    hasOpenPR: false,
  });
  expect(prompt).toContain("## Repository Context");
  expect(prompt).toContain("conventional commits");
});

it("appends repo context to PR fix prompt when set", () => {
  const dispatcher = new Dispatcher();
  dispatcher.setRepoContext("## Custom Skill: pr-format\nUse conventional commits");
  const prompt = dispatcher.buildPRFixPrompt({
    key: "o/r#10",
    owner: "o",
    repo: "r",
    number: 10,
    title: "Add feature",
    body: "",
    headRef: "feature-branch",
    state: "open",
    labels: ["oneagent"],
  }, "Error: test failed");
  expect(prompt).toContain("## Repository Context");
  expect(prompt).toContain("conventional commits");
});

it("appends repo context to PR review feedback prompt when set", () => {
  const dispatcher = new Dispatcher();
  dispatcher.setRepoContext("## Custom Skill: pr-format\nUse conventional commits");
  const prompt = dispatcher.buildPRReviewPrompt(
    {
      key: "o/r#10",
      owner: "o",
      repo: "r",
      number: 10,
      title: "Add feature",
      body: "",
      headRef: "feature-branch",
      state: "open",
      labels: ["oneagent"],
    },
    [{ id: 1, body: "Fix it", path: "a.ts", user: "bob", createdAt: "2026-01-01", pullRequestReviewId: 1 }],
    "diff",
  );
  expect(prompt).toContain("## Repository Context");
  expect(prompt).toContain("conventional commits");
});

it("appends repo context to review dispatch prompt when set", () => {
  const dispatcher = new Dispatcher();
  dispatcher.setRepoContext("## Custom Skill: pr-format\nUse conventional commits");
  const prompt = dispatcher.buildReviewDispatchPrompt(
    {
      key: "o/r#10",
      owner: "o",
      repo: "r",
      number: 10,
      title: "Add feature",
      body: "",
      headRef: "feature-branch",
      state: "open",
      labels: ["oneagent"],
    },
    "+added line",
  );
  expect(prompt).toContain("## Repository Context");
  expect(prompt).toContain("conventional commits");
});

it("does not append context section when no repo context set", () => {
  const dispatcher = new Dispatcher();
  const prompt = dispatcher.buildPrompt({
    key: "o/r#1",
    owner: "o",
    repo: "r",
    number: 1,
    title: "Fix the bug",
    body: "broken",
    labels: ["oneagent"],
    state: "open",
    hasOpenPR: false,
  });
  expect(prompt).not.toContain("Repository Context");
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/orchestrator/__tests__/dispatcher.test.ts`
Expected: FAIL — `setRepoContext` does not exist

**Step 3: Implement Dispatcher changes**

In `src/orchestrator/dispatcher.ts`, add a `repoContext` field and `setRepoContext` method, plus a private helper that all `build*` methods call:

```typescript
export class Dispatcher {
  private repoContext?: string;

  setRepoContext(context: string): void {
    this.repoContext = context;
  }

  private appendRepoContext(prompt: string): string {
    if (!this.repoContext) return prompt;
    return `${prompt}\n\n## Repository Context\n\nThe following project instructions and skills MUST be followed:\n\n${this.repoContext}`;
  }

  buildPrompt(issue: Issue, workDir?: string): string {
    // ... existing code ...
    return this.appendRepoContext(rawPrompt);
  }

  buildPRFixPrompt(pr: PullRequest, failureLogs: string): string {
    // ... existing code ...
    return this.appendRepoContext(rawPrompt);
  }

  buildPRReviewPrompt(pr: PullRequest, comments: ReviewComment[], diff: string, workDir?: string): string {
    // ... existing code ...
    return this.appendRepoContext(rawPrompt);
  }

  buildReviewDispatchPrompt(pr: PullRequest, diff: string): string {
    // ... existing code ...
    return this.appendRepoContext(rawPrompt);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/orchestrator/__tests__/dispatcher.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/orchestrator/dispatcher.ts src/orchestrator/__tests__/dispatcher.test.ts
git commit -m "feat(dispatcher): inject repo context into all agent prompts"
```

---

### Task 2: Wire up repo context discovery in the orchestrator

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`

**Step 1: Import `discoverRepoContext` and call it when dispatching**

At the top of `orchestrator.ts`, add the import:

```typescript
import { discoverRepoContext } from "../tools/repo-context.js";
```

In the `dispatchIssue` method (around line 401), after resolving `workDir`, call `discoverRepoContext` and set it on the dispatcher:

```typescript
const workDir = this.deps.workspace?.ensure(issue.key);
if (workDir) {
  this.dispatcher.setRepoContext(discoverRepoContext(workDir));
}
const prompt = this.dispatcher.buildPrompt(issue, workDir);
```

The PRMonitor's dispatcher also needs context. The simplest approach: the orchestrator sets repo context on the PRMonitor's dispatcher during initialization, or — since PRMonitor creates its own dispatcher internally — expose a method to set context on it.

**Step 2: Handle PRMonitor's dispatcher**

PRMonitor creates `private dispatcher = new Dispatcher()` internally. Add a public method to PRMonitor:

```typescript
setRepoContext(context: string): void {
  this.dispatcher.setRepoContext(context);
}
```

Then in the orchestrator's initialization (where PRMonitor is created), set repo context when a workspace is available. Since repo context depends on the working directory (which varies per issue), and the PRMonitor reuses one dispatcher for all prompts, set it once using the repo's root. The orchestrator already knows the repo root from config.

In the orchestrator constructor or `start()` method, after workspace initialization:

```typescript
// Set repo context for PR monitor prompts
const repoWorkDir = this.deps.workspace?.ensure("_repo-context");
if (repoWorkDir) {
  this.prMonitor.setRepoContext(discoverRepoContext(repoWorkDir));
}
```

Actually, a cleaner approach: the orchestrator's own dispatcher is used for issue prompts and review dispatch prompts. The PRMonitor has its own dispatcher. Set context on both.

**Step 3: Also set context for review dispatch prompts**

The `dispatchPRReview` method (line 566) calls `this.dispatcher.buildReviewDispatchPrompt`. The orchestrator's `this.dispatcher` needs context too. Set it once at startup:

In the orchestrator's initialization, set repo context on `this.dispatcher`. Since we may not have a workDir at startup, do it lazily on first dispatch, or use the config repo path.

Simplest: set it on first `dispatchIssue` call and cache it. Add a field:

```typescript
private repoContextLoaded = false;

// In dispatchIssue, before building prompt:
if (!this.repoContextLoaded && workDir) {
  const ctx = discoverRepoContext(workDir);
  this.dispatcher.setRepoContext(ctx);
  this.prMonitor.setRepoContext(ctx);
  this.repoContextLoaded = true;
}
```

**Step 4: Run full tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/orchestrator/orchestrator.ts src/orchestrator/pr-monitor.ts
git commit -m "feat(orchestrator): discover and inject repo context into all dispatchers"
```

---

### Task 3: Clean up coder prompt

**Files:**
- Modify: `src/agents/prompts.ts`

**Step 1: Remove the mandatory tool call instruction from CODER_PROMPT**

Remove the paragraph starting with "IMPORTANT: After cloning the repository..." and replace with a lighter note that context is already provided:

```typescript
export const CODER_PROMPT = `You are a skilled software engineer working on a GitHub issue.

Repository-specific instructions and skills have been provided in the prompt context below. Follow them strictly — including PR formatting rules, required commands, and conventions.

You also have a "discover_repo_context" tool available to refresh or load additional project context if you switch repositories during the task.

Your workflow:
1. Read and understand the issue requirements
...rest unchanged...`;
```

**Step 2: Run tests**

Run: `npx vitest run`
Expected: ALL PASS (no tests assert on the old prompt text)

**Step 3: Commit**

```bash
git add src/agents/prompts.ts
git commit -m "refactor(agents): simplify coder prompt now that repo context is injected"
```

---

### Task 4: Verify end-to-end with existing repo-context tests

**Files:**
- Read: `src/tools/__tests__/repo-context.test.ts` (existing, no changes needed)

**Step 1: Run the full test suite to verify nothing broke**

Run: `npm test`
Expected: ALL PASS

**Step 2: Run build to verify TypeScript compiles**

Run: `npm run build`
Expected: No errors
