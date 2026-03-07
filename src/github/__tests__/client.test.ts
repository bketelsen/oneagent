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
