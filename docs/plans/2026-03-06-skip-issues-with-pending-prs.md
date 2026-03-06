# Skip Issues With Pending PRs - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent the orchestrator from dispatching agents for issues that already have an open pull request.

**Architecture:** Add a private helper `extractLinkedIssueNumbers()` to `GitHubClient` that scans PR bodies for GitHub linking keywords. Call `octokit.rest.pulls.list()` inside `fetchIssues()` and use the helper to populate `hasOpenPR`. The orchestrator's existing `if (issue.hasOpenPR) continue;` check does the rest.

**Tech Stack:** TypeScript, Vitest, Octokit

---

### Task 1: Add `extractLinkedIssueNumbers` helper with tests

**Files:**
- Modify: `src/github/client.ts` (add private method)
- Modify: `src/github/__tests__/client.test.ts` (add tests)

**Step 1: Write the failing tests**

Add these tests to `src/github/__tests__/client.test.ts`:

```typescript
describe("extractLinkedIssueNumbers", () => {
  // Access the private method for testing
  const client = new GitHubClient("fake-token");
  const extract = (client as any).extractLinkedIssueNumbers.bind(client);

  it("extracts issue number from 'Fixes #26'", () => {
    expect(extract("Fixes #26")).toEqual(new Set([26]));
  });

  it("extracts issue number from 'Closes #42'", () => {
    expect(extract("Closes #42")).toEqual(new Set([42]));
  });

  it("extracts issue number from 'Resolves #10'", () => {
    expect(extract("Resolves #10")).toEqual(new Set([10]));
  });

  it("extracts multiple issue numbers", () => {
    expect(extract("Fixes #26, also closes #30")).toEqual(new Set([26, 30]));
  });

  it("is case-insensitive", () => {
    expect(extract("FIXES #26")).toEqual(new Set([26]));
  });

  it("returns empty set for null/undefined body", () => {
    expect(extract(null)).toEqual(new Set());
    expect(extract(undefined)).toEqual(new Set());
  });

  it("returns empty set when no keywords match", () => {
    expect(extract("This PR adds a feature")).toEqual(new Set());
  });

  it("handles past tense keywords", () => {
    expect(extract("Fixed #5, resolved #6, closed #7")).toEqual(new Set([5, 6, 7]));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/github/__tests__/client.test.ts`
Expected: FAIL — `extractLinkedIssueNumbers` is not a function

**Step 3: Write the implementation**

Add this private method to `GitHubClient` in `src/github/client.ts`:

```typescript
private extractLinkedIssueNumbers(body: string | null | undefined): Set<number> {
  if (!body) return new Set();
  const pattern = /(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)/gi;
  const numbers = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    numbers.add(parseInt(match[1], 10));
  }
  return numbers;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/github/__tests__/client.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add src/github/client.ts src/github/__tests__/client.test.ts
git commit -m "feat: add extractLinkedIssueNumbers helper to GitHubClient"
```

---

### Task 2: Populate `hasOpenPR` in `fetchIssues` with tests

**Files:**
- Modify: `src/github/client.ts:24-41` (update `fetchIssues` method)
- Modify: `src/github/__tests__/client.test.ts` (add integration-style tests)

**Step 1: Write the failing tests**

These tests mock `octokit` to verify `fetchIssues` wires up the PR lookup correctly. Add to `src/github/__tests__/client.test.ts`:

```typescript
import { vi } from "vitest";

describe("fetchIssues hasOpenPR population", () => {
  function createMockClient(issues: any[], prs: any[]) {
    const client = new GitHubClient("fake-token");
    // Mock the octokit instance
    (client as any).octokit = {
      rest: {
        issues: {
          listForRepo: vi.fn().mockResolvedValue({ data: issues }),
        },
        pulls: {
          list: vi.fn().mockResolvedValue({ data: prs }),
        },
      },
    };
    return client;
  }

  it("sets hasOpenPR true when a PR body references the issue", async () => {
    const client = createMockClient(
      [{ number: 26, title: "Add feature", body: "desc", state: "open", labels: [] }],
      [{ number: 29, title: "Fix", body: "Fixes #26", state: "open", labels: [], head: { ref: "fix-26" } }],
    );
    const issues = await client.fetchIssues("owner", "repo", "oneagent");
    expect(issues).toHaveLength(1);
    expect(issues[0].hasOpenPR).toBe(true);
  });

  it("sets hasOpenPR false when no PR references the issue", async () => {
    const client = createMockClient(
      [{ number: 26, title: "Add feature", body: "desc", state: "open", labels: [] }],
      [{ number: 30, title: "Unrelated", body: "Some other work", state: "open", labels: [], head: { ref: "other" } }],
    );
    const issues = await client.fetchIssues("owner", "repo", "oneagent");
    expect(issues).toHaveLength(1);
    expect(issues[0].hasOpenPR).toBe(false);
  });

  it("sets hasOpenPR false when there are no open PRs", async () => {
    const client = createMockClient(
      [{ number: 26, title: "Add feature", body: "desc", state: "open", labels: [] }],
      [],
    );
    const issues = await client.fetchIssues("owner", "repo", "oneagent");
    expect(issues).toHaveLength(1);
    expect(issues[0].hasOpenPR).toBe(false);
  });

  it("handles PR with null body", async () => {
    const client = createMockClient(
      [{ number: 26, title: "Add feature", body: "desc", state: "open", labels: [] }],
      [{ number: 29, title: "Fix", body: null, state: "open", labels: [], head: { ref: "fix-26" } }],
    );
    const issues = await client.fetchIssues("owner", "repo", "oneagent");
    expect(issues[0].hasOpenPR).toBe(false);
  });

  it("filters out pull_request items from issues list", async () => {
    const client = createMockClient(
      [
        { number: 26, title: "Issue", body: "desc", state: "open", labels: [], pull_request: undefined },
        { number: 29, title: "PR as issue", body: "desc", state: "open", labels: [], pull_request: { url: "..." } },
      ],
      [],
    );
    const issues = await client.fetchIssues("owner", "repo", "oneagent");
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(26);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/github/__tests__/client.test.ts`
Expected: FAIL — `fetchIssues` still hardcodes `hasOpenPR: false`

**Step 3: Update `fetchIssues` implementation**

Replace the `fetchIssues` method in `src/github/client.ts` with:

```typescript
async fetchIssues(owner: string, repo: string, label: string): Promise<Issue[]> {
  const [{ data }, { data: prs }] = await Promise.all([
    this.octokit.rest.issues.listForRepo({
      owner, repo, labels: label, state: "open", per_page: 100,
    }),
    this.octokit.rest.pulls.list({
      owner, repo, state: "open", per_page: 100,
    }),
  ]);
  this.logger.debug({ owner, repo, label, issueCount: data.length, prCount: prs.length }, "fetched issues and PRs");

  const linkedIssues = new Set<number>();
  for (const pr of prs) {
    for (const num of this.extractLinkedIssueNumbers(pr.body)) {
      linkedIssues.add(num);
    }
  }

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
      hasOpenPR: linkedIssues.has(i.number),
    }));
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/github/__tests__/client.test.ts`
Expected: All PASS

**Step 5: Run all tests to check for regressions**

Run: `npx vitest run`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/github/client.ts src/github/__tests__/client.test.ts
git commit -m "feat: populate hasOpenPR by checking open PR bodies for issue references"
```

---

### Task 3: Add logging for skipped issues in orchestrator

**Files:**
- Modify: `src/orchestrator/orchestrator.ts:92` (add log line)

**Step 1: Add a debug log when skipping**

In `src/orchestrator/orchestrator.ts`, change line 92 from:

```typescript
if (issue.hasOpenPR) continue;
```

to:

```typescript
if (issue.hasOpenPR) {
  this.logger.debug({ issueKey: issue.key }, "skipping issue with open PR");
  continue;
}
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All PASS

**Step 3: Commit**

```bash
git add src/orchestrator/orchestrator.ts
git commit -m "feat: log when skipping issues with pending PRs"
```
