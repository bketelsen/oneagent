import { describe, it, expect } from "vitest";
import { estimateCost } from "../cost.js";

describe("estimateCost", () => {
  it("returns correct cost for claude-sonnet-4-6", () => {
    // 1000 input tokens @ $3/1M + 500 output tokens @ $15/1M
    const cost = estimateCost("anthropic", "claude-sonnet-4-6", 1000, 500);
    expect(cost).toBeCloseTo((1000 * 3 + 500 * 15) / 1_000_000);
    expect(cost).toBeGreaterThan(0);
  });

  it("returns correct cost for claude-opus-4-6", () => {
    const cost = estimateCost("anthropic", "claude-opus-4-6", 2000, 1000);
    expect(cost).toBeCloseTo((2000 * 15 + 1000 * 75) / 1_000_000);
  });

  it("returns correct cost for claude-haiku-4-5-20251001", () => {
    const cost = estimateCost("anthropic", "claude-haiku-4-5-20251001", 5000, 2000);
    expect(cost).toBeCloseTo((5000 * 0.8 + 2000 * 4) / 1_000_000);
  });

  it("returns 0 for unknown models", () => {
    expect(estimateCost("unknown", "mystery-model", 1000, 500)).toBe(0);
  });

  it("returns 0 for claude-code provider regardless of model", () => {
    expect(estimateCost("claude-code", "claude-sonnet-4-6", 1000, 500)).toBe(0);
    expect(estimateCost("claude-code", undefined, 1000, 500)).toBe(0);
  });

  it("returns 0 for undefined model", () => {
    expect(estimateCost("anthropic", undefined, 1000, 500)).toBe(0);
  });
});
