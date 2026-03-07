import { describe, it, expect } from "vitest";
import { Dispatcher } from "../dispatcher.js";

describe("Dispatcher", () => {
  it("builds a prompt from an issue", () => {
    const dispatcher = new Dispatcher();
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
    expect(prompt).toContain("Fix the bug");
    expect(prompt).toContain("The button is broken");
    expect(prompt).toContain("o/r#1");
  });

  it("includes workspace path when provided", () => {
    const dispatcher = new Dispatcher();
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
    }, "/home/user/workspaces/o-r-1");
    expect(prompt).toContain("**Workspace:** /home/user/workspaces/o-r-1");
  });

  it("omits workspace line when not provided", () => {
    const dispatcher = new Dispatcher();
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
    expect(prompt).not.toContain("Workspace:");
  });

  it("builds a PR fix prompt", () => {
    const dispatcher = new Dispatcher();
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
    }, "Error: test failed on line 42");
    expect(prompt).toContain("feature-branch");
    expect(prompt).toContain("test failed on line 42");
  });

  it("builds a PR review feedback prompt", () => {
    const dispatcher = new Dispatcher();
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
      [
        { id: 1, body: "Please fix the naming", path: "src/index.ts", user: "reviewer", createdAt: "2026-01-01", pullRequestReviewId: 1 },
        { id: 2, body: "Add a test for this", path: "src/utils.ts", user: "reviewer2", createdAt: "2026-01-01", pullRequestReviewId: 2 },
      ],
      "+added line\n-removed line",
    );
    expect(prompt).toContain("PR Review Feedback: o/r#10");
    expect(prompt).toContain("feature-branch");
    expect(prompt).toContain("Please fix the naming");
    expect(prompt).toContain("Add a test for this");
    expect(prompt).toContain("src/index.ts");
    expect(prompt).toContain("src/utils.ts");
    expect(prompt).toContain("+added line");
    expect(prompt).toContain("Do NOT create a new PR");
  });

  it("includes workspace in PR review prompt when provided", () => {
    const dispatcher = new Dispatcher();
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
      "/tmp/workspace",
    );
    expect(prompt).toContain("**Workspace:** /tmp/workspace");
  });

  it("omits workspace in PR review prompt when not provided", () => {
    const dispatcher = new Dispatcher();
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
    expect(prompt).not.toContain("Workspace:");
  });

  it("builds a review dispatch prompt for the pr-reviewer agent", () => {
    const dispatcher = new Dispatcher();
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
      "+added line\n-removed line",
    );
    expect(prompt).toContain("PR Review: o/r#10");
    expect(prompt).toContain("Add feature");
    expect(prompt).toContain("feature-branch");
    expect(prompt).toContain("+added line");
    expect(prompt).toContain("APPROVE");
    expect(prompt).toContain("REQUEST_CHANGES");
  });
});
