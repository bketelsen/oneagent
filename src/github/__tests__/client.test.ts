import { describe, it, expect } from "vitest";
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
