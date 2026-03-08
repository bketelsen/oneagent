# Sprint Board Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the empty sprint board stub with a real implementation that categorizes GitHub issues into Todo/In Progress/In Review/Done columns.

**Architecture:** `getBoard()` fetches open eligible issues and recently closed issues from GitHub API, then categorizes them using orchestrator RunState (in-memory) and RunsRepo (SQLite). A refresh button on the page allows manual reload.

**Tech Stack:** TypeScript, Hono JSX, Octokit, better-sqlite3, Vitest

---

### Task 1: Add `fetchClosedIssues` to GitHubClient

**Files:**
- Modify: `src/github/client.ts` (add method after `fetchIssues`, around line 73)
- Test: `src/github/__tests__/client.test.ts`

**Step 1: Write the failing test**

Add to `src/github/__tests__/client.test.ts`:

```typescript
describe("fetchClosedIssues", () => {
  it("fetches closed issues since a given date", async () => {
    const client = new GitHubClient("fake-token");
    // The method should exist and accept owner, repo, since
    expect(typeof client.fetchClosedIssues).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/github/__tests__/client.test.ts -t "fetches closed issues"`
Expected: FAIL — `fetchClosedIssues` is not a function

**Step 3: Write the implementation**

Add this method to `GitHubClient` in `src/github/client.ts` after the `fetchIssues` method (after line 73):

```typescript
async fetchClosedIssues(owner: string, repo: string, since: Date): Promise<Issue[]> {
  const { data } = await this.octokit.rest.issues.listForRepo({
    owner, repo, state: "closed", since: since.toISOString(), per_page: 100,
  });
  this.logger.debug({ owner, repo, since: since.toISOString(), count: data.length }, "fetched closed issues");
  return data
    .filter((i) => !i.pull_request)
    .map((i) => ({
      key: this.issueKey(owner, repo, i.number),
      owner, repo,
      number: i.number,
      title: i.title,
      body: i.body ?? "",
      labels: i.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
      state: i.state,
      hasOpenPR: false,
    }));
}
```

Note: `hasOpenPR` is set to `false` for closed issues — we don't need PR linkage for the Done column since we check RunsRepo instead.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/github/__tests__/client.test.ts -t "fetches closed issues"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/github/client.ts src/github/__tests__/client.test.ts
git commit -m "feat(github): add fetchClosedIssues method"
```

---

### Task 2: Wire up real `getBoard()` implementation

**Files:**
- Modify: `src/index.ts:109-111` (replace the stub)

**Step 1: Replace the stub**

In `src/index.ts`, replace lines 109-111:

```typescript
        sprint: {
          getBoard: async () => ({ todo: [], inProgress: [], inReview: [], done: [] }),
        },
```

With:

```typescript
        sprint: {
          getBoard: async () => {
            const todo: Array<{ key: string; title: string }> = [];
            const inProgress: Array<{ key: string; title: string }> = [];
            const inReview: Array<{ key: string; title: string }> = [];
            const done: Array<{ key: string; title: string }> = [];

            const since = new Date();
            since.setDate(since.getDate() - 30);

            for (const repo of config.github.repos) {
              const [openIssues, closedIssues] = await Promise.all([
                github.fetchIssues(repo.owner, repo.repo, config.labels.eligible),
                github.fetchClosedIssues(repo.owner, repo.repo, since),
              ]);

              for (const issue of openIssues) {
                if (orchestrator.state.isRunning(issue.key)) {
                  inProgress.push({ key: issue.key, title: issue.title });
                } else if (issue.hasOpenPR) {
                  inReview.push({ key: issue.key, title: issue.title });
                } else {
                  todo.push({ key: issue.key, title: issue.title });
                }
              }

              for (const issue of closedIssues) {
                const runs = runsRepo.listByIssue(issue.key);
                if (runs.some((r) => r.status === "completed")) {
                  done.push({ key: issue.key, title: issue.title });
                }
              }
            }

            return { todo, inProgress, inReview, done };
          },
        },
```

**Step 2: Build to verify no type errors**

Run: `npm run build`
Expected: Clean compilation, no errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(sprint): wire up real getBoard implementation"
```

---

### Task 3: Add refresh button to sprint page

**Files:**
- Modify: `src/web/routes/sprint.tsx:26` (add button inside Layout, before the grid)

**Step 1: Add the refresh button**

In `src/web/routes/sprint.tsx`, replace lines 26-27:

```tsx
      <Layout title="Sprint Board">
        <div class="grid grid-cols-4 gap-4">
```

With:

```tsx
      <Layout title="Sprint Board">
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Sprint Board</h2>
          <a href="/sprint" class="px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
            Refresh
          </a>
        </div>
        <div class="grid grid-cols-4 gap-4">
```

**Step 2: Build to verify no errors**

Run: `npm run build`
Expected: Clean compilation

**Step 3: Commit**

```bash
git add src/web/routes/sprint.tsx
git commit -m "feat(sprint): add refresh button to sprint board page"
```

---

### Task 4: Run full test suite and verify

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass (no existing tests should break since we only added a new method and changed a stub)

**Step 2: Final commit if any fixups needed**

If tests revealed issues, fix and commit with appropriate message.
