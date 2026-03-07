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
      headRef: "feature-branch",
      state: "open",
      labels: ["oneagent"],
    }, "Error: test failed on line 42");
    expect(prompt).toContain("feature-branch");
    expect(prompt).toContain("test failed on line 42");
  });
});
