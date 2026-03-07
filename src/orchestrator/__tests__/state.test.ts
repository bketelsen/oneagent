import { describe, it, expect } from "vitest";
import { RunState } from "../state.js";

describe("RunState", () => {
  it("tracks active runs", () => {
    const state = new RunState();
    state.add("o/r#1", { runId: "r1", issueKey: "o/r#1", provider: "claude-code", startedAt: new Date(), lastActivity: new Date(), retryCount: 0, currentAgent: "coder", lastActivityDescription: "Starting...", toolCallCount: 0 });
    expect(state.isRunning("o/r#1")).toBe(true);
    expect(state.activeCount()).toBe(1);
  });

  it("removes completed runs", () => {
    const state = new RunState();
    state.add("o/r#1", { runId: "r1", issueKey: "o/r#1", provider: "claude-code", startedAt: new Date(), lastActivity: new Date(), retryCount: 0, currentAgent: "coder", lastActivityDescription: "Starting...", toolCallCount: 0 });
    state.remove("o/r#1");
    expect(state.isRunning("o/r#1")).toBe(false);
    expect(state.activeCount()).toBe(0);
  });

  it("iterates running entries", () => {
    const state = new RunState();
    state.add("o/r#1", { runId: "r1", issueKey: "o/r#1", provider: "claude-code", startedAt: new Date(), lastActivity: new Date(), retryCount: 0, currentAgent: "coder", lastActivityDescription: "Starting...", toolCallCount: 0 });
    state.add("o/r#2", { runId: "r2", issueKey: "o/r#2", provider: "codex", startedAt: new Date(), lastActivity: new Date(), retryCount: 0, currentAgent: "coder", lastActivityDescription: "Starting...", toolCallCount: 0 });
    const entries = [...state.running()];
    expect(entries).toHaveLength(2);
  });
});
