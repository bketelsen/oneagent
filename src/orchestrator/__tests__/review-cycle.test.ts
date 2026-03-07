import { describe, it, expect } from "vitest";
import { ReviewCycleState } from "../state.js";

describe("ReviewCycleState", () => {
  it("returns 0 for unknown PR keys", () => {
    const state = new ReviewCycleState();
    expect(state.getCycleCount("owner/repo#10")).toBe(0);
  });

  it("increments cycle count", () => {
    const state = new ReviewCycleState();
    state.increment("owner/repo#10");
    expect(state.getCycleCount("owner/repo#10")).toBe(1);
    state.increment("owner/repo#10");
    expect(state.getCycleCount("owner/repo#10")).toBe(2);
  });

  it("checks if max cycles exceeded", () => {
    const state = new ReviewCycleState();
    state.increment("owner/repo#10");
    state.increment("owner/repo#10");
    expect(state.isExhausted("owner/repo#10", 2)).toBe(true);
    expect(state.isExhausted("owner/repo#10", 3)).toBe(false);
  });

  it("resets cycle count for a PR", () => {
    const state = new ReviewCycleState();
    state.increment("owner/repo#10");
    state.increment("owner/repo#10");
    state.reset("owner/repo#10");
    expect(state.getCycleCount("owner/repo#10")).toBe(0);
  });
});
