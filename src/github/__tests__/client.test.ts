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
