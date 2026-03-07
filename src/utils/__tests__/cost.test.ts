import { describe, it, expect } from "vitest";
import {
  getCostEstimate,
  formatCost,
  DEFAULT_INPUT_COST_PER_MILLION,
  DEFAULT_OUTPUT_COST_PER_MILLION,
} from "../cost.js";

describe("getCostEstimate", () => {
  it("returns 0 for zero tokens", () => {
    expect(getCostEstimate(0, 0)).toBe(0);
  });

  it("calculates cost with default pricing", () => {
    // 1M input tokens = $15, 1M output tokens = $75
    const cost = getCostEstimate(1_000_000, 1_000_000);
    expect(cost).toBe(90); // $15 + $75
  });

  it("calculates cost for small token counts", () => {
    // 1000 input = $0.015, 500 output = $0.0375
    const cost = getCostEstimate(1000, 500);
    expect(cost).toBeCloseTo(0.0525, 6);
  });

  it("calculates input-only cost", () => {
    const cost = getCostEstimate(500_000, 0);
    expect(cost).toBeCloseTo(7.5, 6); // $15 * 0.5
  });

  it("calculates output-only cost", () => {
    const cost = getCostEstimate(0, 200_000);
    expect(cost).toBeCloseTo(15, 6); // $75 * 0.2
  });

  it("accepts custom pricing", () => {
    const cost = getCostEstimate(1_000_000, 1_000_000, 10, 50);
    expect(cost).toBe(60); // $10 + $50
  });

  it("exports default pricing constants", () => {
    expect(DEFAULT_INPUT_COST_PER_MILLION).toBe(15);
    expect(DEFAULT_OUTPUT_COST_PER_MILLION).toBe(75);
  });
});

describe("formatCost", () => {
  it("formats zero cost", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats small cost with 2 decimal places", () => {
    expect(formatCost(0.42)).toBe("$0.42");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatCost(0.4275)).toBe("$0.43");
  });

  it("formats large cost", () => {
    expect(formatCost(123.456)).toBe("$123.46");
  });

  it("formats whole dollar amounts", () => {
    expect(formatCost(5)).toBe("$5.00");
  });
});
