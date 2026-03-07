import { describe, it, expect, vi } from "vitest";
import { GitHubClient } from "../client.js";

describe("GitHubClient", () => {
  it("constructs issue key from owner/repo/number", () => {
    const client = new GitHubClient("fake-token");
    expect(client.issueKey("owner", "repo", 42)).toBe("owner/repo#42");
  });

  it("parses issue key", () => {
    const client = new GitHubClient("fake-token");
    const parsed = client.parseIssueKey("owner/repo#42");
    expect(parsed).toEqual({ owner: "owner", repo: "repo", number: 42 });
  });

  it("returns null for invalid issue key", () => {
    const client = new GitHubClient("fake-token");
    expect(client.parseIssueKey("invalid")).toBeNull();
  });
});

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

describe("fetchIssues OR logic with multiple labels", () => {
  function createMockClientMultiLabel(issuesByLabel: Record<string, any[]>, prs: any[] = []) {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        issues: {
          listForRepo: vi.fn().mockImplementation(({ labels }: { labels: string }) => {
            return Promise.resolve({ data: issuesByLabel[labels] ?? [] });
          }),
        },
        pulls: {
          list: vi.fn().mockResolvedValue({ data: prs }),
        },
      },
    };
    return client;
  }

  it("fetches issues matching ANY of the configured labels (OR logic)", async () => {
    const client = createMockClientMultiLabel({
      "bug": [{ number: 1, title: "Bug issue", body: "", state: "open", labels: [{ name: "bug" }] }],
      "feature": [{ number: 2, title: "Feature issue", body: "", state: "open", labels: [{ name: "feature" }] }],
    });
    const issues = await client.fetchIssues("owner", "repo", ["bug", "feature"]);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.number)).toContain(1);
    expect(issues.map((i) => i.number)).toContain(2);
  });

  it("deduplicates issues that match multiple labels", async () => {
    const sharedIssue = { number: 1, title: "Both labels", body: "", state: "open", labels: [{ name: "bug" }, { name: "feature" }] };
    const client = createMockClientMultiLabel({
      "bug": [sharedIssue],
      "feature": [sharedIssue],
    });
    const issues = await client.fetchIssues("owner", "repo", ["bug", "feature"]);
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);
  });

  it("works with a single label in the array", async () => {
    const client = createMockClientMultiLabel({
      "oneagent": [{ number: 5, title: "Solo", body: "", state: "open", labels: [{ name: "oneagent" }] }],
    });
    const issues = await client.fetchIssues("owner", "repo", ["oneagent"]);
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(5);
  });

  it("returns empty array when no issues match any label", async () => {
    const client = createMockClientMultiLabel({
      "bug": [],
      "feature": [],
    });
    const issues = await client.fetchIssues("owner", "repo", ["bug", "feature"]);
    expect(issues).toHaveLength(0);
  });

  it("still supports a single string label for backward compatibility", async () => {
    const client = createMockClientMultiLabel({
      "oneagent": [{ number: 10, title: "Compat", body: "", state: "open", labels: [{ name: "oneagent" }] }],
    });
    const issues = await client.fetchIssues("owner", "repo", "oneagent");
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(10);
  });
});

describe("parseDependencies", () => {
  const client = new GitHubClient("fake-token");

  it("parses 'Depends on #N'", () => {
    expect(client.parseDependencies("Depends on #5")).toEqual([5]);
  });

  it("parses 'Blocked by #N'", () => {
    expect(client.parseDependencies("Blocked by #10")).toEqual([10]);
  });

  it("parses 'Requires #N'", () => {
    expect(client.parseDependencies("Requires #3")).toEqual([3]);
  });

  it("is case-insensitive", () => {
    expect(client.parseDependencies("DEPENDS ON #7")).toEqual([7]);
    expect(client.parseDependencies("blocked BY #8")).toEqual([8]);
  });

  it("parses multiple dependencies", () => {
    expect(client.parseDependencies("Depends on #1\nBlocked by #2\nRequires #3")).toEqual([1, 2, 3]);
  });

  it("deduplicates dependency numbers", () => {
    expect(client.parseDependencies("Depends on #5\nBlocked by #5")).toEqual([5]);
  });

  it("returns empty array for null/undefined body", () => {
    expect(client.parseDependencies(null)).toEqual([]);
    expect(client.parseDependencies(undefined)).toEqual([]);
  });

  it("returns empty array when no dependency markers found", () => {
    expect(client.parseDependencies("This is a regular issue body")).toEqual([]);
  });
});

describe("isIssueClosed", () => {
  it("returns true when issue state is closed", async () => {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        issues: {
          get: vi.fn().mockResolvedValue({ data: { state: "closed" } }),
        },
      },
    };
    expect(await client.isIssueClosed("owner", "repo", 1)).toBe(true);
  });

  it("returns false when issue state is open", async () => {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        issues: {
          get: vi.fn().mockResolvedValue({ data: { state: "open" } }),
        },
      },
    };
    expect(await client.isIssueClosed("owner", "repo", 1)).toBe(false);
  });
});

describe("fetchPRReviewComments", () => {
  function createMockClientForReviews(reviewComments: any[], issueComments: any[] = []) {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        pulls: {
          list: vi.fn().mockResolvedValue({ data: [] }),
          listReviewComments: vi.fn().mockResolvedValue({ data: reviewComments }),
          get: vi.fn().mockResolvedValue({ data: "diff content" }),
        },
        issues: {
          listComments: vi.fn().mockResolvedValue({ data: issueComments }),
        },
      },
    };
    return client;
  }

  it("returns mapped inline review comments", async () => {
    const client = createMockClientForReviews([
      {
        id: 100,
        body: "Fix this typo",
        path: "src/index.ts",
        user: { login: "reviewer" },
        created_at: "2026-01-01T00:00:00Z",
        pull_request_review_id: 42,
      },
      {
        id: 101,
        body: "Add error handling",
        path: "src/utils.ts",
        user: { login: "reviewer2" },
        created_at: "2026-01-02T00:00:00Z",
        pull_request_review_id: 43,
      },
    ]);

    const comments = await client.fetchPRReviewComments("owner", "repo", 10);
    expect(comments).toHaveLength(2);
    // Sorted desc by createdAt, so newer first
    expect(comments[0]).toEqual({
      id: 101,
      body: "Add error handling",
      path: "src/utils.ts",
      user: "reviewer2",
      createdAt: "2026-01-02T00:00:00Z",
      pullRequestReviewId: 43,
    });
    expect(comments[1].user).toBe("reviewer");
  });

  it("handles comments with null user", async () => {
    const client = createMockClientForReviews([
      {
        id: 200,
        body: "Comment",
        path: "file.ts",
        user: null,
        created_at: "2026-01-01T00:00:00Z",
        pull_request_review_id: null,
      },
    ]);

    const comments = await client.fetchPRReviewComments("owner", "repo", 5);
    expect(comments).toHaveLength(1);
    expect(comments[0].user).toBe("unknown");
  });

  it("returns empty array when no comments of any type", async () => {
    const client = createMockClientForReviews([]);
    const comments = await client.fetchPRReviewComments("owner", "repo", 5);
    expect(comments).toHaveLength(0);
  });

  it("returns issue comments (regular PR conversation comments)", async () => {
    const client = createMockClientForReviews([], [
      {
        id: 300,
        body: "Please fix the README",
        user: { login: "commenter" },
        created_at: "2026-01-03T00:00:00Z",
      },
    ]);

    const comments = await client.fetchPRReviewComments("owner", "repo", 10);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toEqual({
      id: 300,
      body: "Please fix the README",
      user: "commenter",
      createdAt: "2026-01-03T00:00:00Z",
      pullRequestReviewId: null,
    });
    expect(comments[0].path).toBeUndefined();
  });

  it("merges inline review comments and issue comments sorted by date desc", async () => {
    const client = createMockClientForReviews(
      [
        {
          id: 100,
          body: "Inline comment",
          path: "src/index.ts",
          user: { login: "reviewer" },
          created_at: "2026-01-01T00:00:00Z",
          pull_request_review_id: 42,
        },
      ],
      [
        {
          id: 300,
          body: "Issue comment",
          user: { login: "commenter" },
          created_at: "2026-01-02T00:00:00Z",
        },
      ],
    );

    const comments = await client.fetchPRReviewComments("owner", "repo", 10);
    expect(comments).toHaveLength(2);
    // Issue comment is newer, so it should be first
    expect(comments[0].id).toBe(300);
    expect(comments[0].body).toBe("Issue comment");
    expect(comments[0].path).toBeUndefined();
    expect(comments[1].id).toBe(100);
    expect(comments[1].body).toBe("Inline comment");
    expect(comments[1].path).toBe("src/index.ts");
  });

  it("handles issue comments with null body and user", async () => {
    const client = createMockClientForReviews([], [
      {
        id: 400,
        body: null,
        user: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);

    const comments = await client.fetchPRReviewComments("owner", "repo", 5);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("");
    expect(comments[0].user).toBe("unknown");
  });
});

describe("fetchPRsWithReviewFeedback", () => {
  function createMockClientForFeedback(
    prs: any[],
    reviewCommentsByPR: Record<number, any[]>,
    issueCommentsByPR: Record<number, any[]> = {},
  ) {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        pulls: {
          list: vi.fn().mockResolvedValue({ data: prs }),
          listReviewComments: vi.fn().mockImplementation(({ pull_number }: { pull_number: number }) => {
            return Promise.resolve({ data: reviewCommentsByPR[pull_number] ?? [] });
          }),
        },
        issues: {
          listComments: vi.fn().mockImplementation(({ issue_number }: { issue_number: number }) => {
            return Promise.resolve({ data: issueCommentsByPR[issue_number] ?? [] });
          }),
        },
      },
    };
    return client;
  }

  it("returns PRs with new review comments", async () => {
    const client = createMockClientForFeedback(
      [
        { number: 10, title: "PR 10", state: "open", labels: [{ name: "oneagent-working" }], head: { ref: "branch-10" } },
      ],
      {
        10: [
          { id: 100, body: "Fix this", path: "a.ts", user: { login: "alice" }, created_at: "2026-01-01", pull_request_review_id: 1 },
          { id: 101, body: "And this", path: "b.ts", user: { login: "bob" }, created_at: "2026-01-02", pull_request_review_id: 2 },
        ],
      },
    );

    const results = await client.fetchPRsWithReviewFeedback("owner", "repo", "oneagent-working", new Map());
    expect(results).toHaveLength(1);
    expect(results[0].pr.number).toBe(10);
    expect(results[0].comments).toHaveLength(2);
    expect(results[0].latestCommentId).toBe(101);
  });

  it("skips PRs whose comments have already been processed", async () => {
    const client = createMockClientForFeedback(
      [
        { number: 10, title: "PR 10", state: "open", labels: [{ name: "oneagent-working" }], head: { ref: "branch-10" } },
      ],
      {
        10: [
          { id: 100, body: "Fix this", path: "a.ts", user: { login: "alice" }, created_at: "2026-01-01", pull_request_review_id: 1 },
        ],
      },
    );

    const lastProcessed = new Map([["owner/repo#10", 100]]);
    const results = await client.fetchPRsWithReviewFeedback("owner", "repo", "oneagent-working", lastProcessed);
    expect(results).toHaveLength(0);
  });

  it("returns only new comments when some have been processed", async () => {
    const client = createMockClientForFeedback(
      [
        { number: 10, title: "PR 10", state: "open", labels: [{ name: "oneagent-working" }], head: { ref: "branch-10" } },
      ],
      {
        10: [
          { id: 100, body: "Old comment", path: "a.ts", user: { login: "alice" }, created_at: "2026-01-01", pull_request_review_id: 1 },
          { id: 200, body: "New comment", path: "b.ts", user: { login: "bob" }, created_at: "2026-01-02", pull_request_review_id: 2 },
        ],
      },
    );

    const lastProcessed = new Map([["owner/repo#10", 100]]);
    const results = await client.fetchPRsWithReviewFeedback("owner", "repo", "oneagent-working", lastProcessed);
    expect(results).toHaveLength(1);
    expect(results[0].comments).toHaveLength(1);
    expect(results[0].comments[0].id).toBe(200);
    expect(results[0].latestCommentId).toBe(200);
  });

  it("skips PRs with no review comments", async () => {
    const client = createMockClientForFeedback(
      [
        { number: 10, title: "PR 10", state: "open", labels: [{ name: "oneagent-working" }], head: { ref: "branch-10" } },
      ],
      { 10: [] },
    );

    const results = await client.fetchPRsWithReviewFeedback("owner", "repo", "oneagent-working", new Map());
    expect(results).toHaveLength(0);
  });
});

describe("hasOpenPRForIssue", () => {
  function createMockClientForHasOpenPR(prs: any[]) {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        pulls: {
          list: vi.fn().mockResolvedValue({ data: prs }),
        },
      },
    };
    return client;
  }

  it("returns true when an open PR references the issue", async () => {
    const client = createMockClientForHasOpenPR([
      { number: 5, body: "Fixes #10", state: "open", labels: [], head: { ref: "fix-10" } },
    ]);
    expect(await client.hasOpenPRForIssue("owner", "repo", 10)).toBe(true);
  });

  it("returns false when no open PR references the issue", async () => {
    const client = createMockClientForHasOpenPR([
      { number: 5, body: "Fixes #99", state: "open", labels: [], head: { ref: "fix-99" } },
    ]);
    expect(await client.hasOpenPRForIssue("owner", "repo", 10)).toBe(false);
  });

  it("returns false when there are no open PRs", async () => {
    const client = createMockClientForHasOpenPR([]);
    expect(await client.hasOpenPRForIssue("owner", "repo", 10)).toBe(false);
  });

  it("returns false when PR body is null", async () => {
    const client = createMockClientForHasOpenPR([
      { number: 5, body: null, state: "open", labels: [], head: { ref: "branch" } },
    ]);
    expect(await client.hasOpenPRForIssue("owner", "repo", 10)).toBe(false);
  });
});

describe("fetchOpenPRs", () => {
  function createMockClientForOpenPRs(prs: any[]) {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        pulls: {
          list: vi.fn().mockResolvedValue({ data: prs }),
        },
      },
    };
    return client;
  }

  it("returns all open PRs mapped to PullRequest type", async () => {
    const client = createMockClientForOpenPRs([
      { number: 1, title: "PR 1", state: "open", labels: [{ name: "bug" }], head: { ref: "fix-1" } },
      { number: 2, title: "PR 2", state: "open", labels: [], head: { ref: "feat-2" } },
    ]);
    const prs = await client.fetchOpenPRs("owner", "repo");
    expect(prs).toHaveLength(2);
    expect(prs[0]).toEqual({
      key: "owner/repo#1",
      owner: "owner",
      repo: "repo",
      number: 1,
      title: "PR 1",
      headRef: "fix-1",
      state: "open",
      labels: ["bug"],
    });
    expect(prs[1].headRef).toBe("feat-2");
  });

  it("returns empty array when no open PRs", async () => {
    const client = createMockClientForOpenPRs([]);
    const prs = await client.fetchOpenPRs("owner", "repo");
    expect(prs).toHaveLength(0);
  });
});

describe("fetchPRMergeableStatus", () => {
  it("returns mergeable status from PR detail", async () => {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: { mergeable: false, mergeable_state: "dirty" },
          }),
        },
      },
    };
    const status = await client.fetchPRMergeableStatus("owner", "repo", 10);
    expect(status).toEqual({ mergeable: false, mergeableState: "dirty" });
  });

  it("returns null mergeable when GitHub has not computed it yet", async () => {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: { mergeable: null, mergeable_state: "unknown" },
          }),
        },
      },
    };
    const status = await client.fetchPRMergeableStatus("owner", "repo", 5);
    expect(status).toEqual({ mergeable: null, mergeableState: "unknown" });
  });

  it("returns true mergeable when PR is clean", async () => {
    const client = new GitHubClient("fake-token");
    (client as any).octokit = {
      rest: {
        pulls: {
          get: vi.fn().mockResolvedValue({
            data: { mergeable: true, mergeable_state: "clean" },
          }),
        },
      },
    };
    const status = await client.fetchPRMergeableStatus("owner", "repo", 3);
    expect(status).toEqual({ mergeable: true, mergeableState: "clean" });
  });
});
