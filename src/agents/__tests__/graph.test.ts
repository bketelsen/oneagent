import { describe, it, expect } from "vitest";
import { buildAgentGraph } from "../graph.js";

describe("buildAgentGraph", () => {
  it("returns a map with all agents", () => {
    const graph = buildAgentGraph();
    expect(graph.has("coder")).toBe(true);
    expect(graph.has("tdd")).toBe(true);
    expect(graph.has("debugger")).toBe(true);
    expect(graph.has("reviewer")).toBe(true);
    expect(graph.has("pr-workflow")).toBe(true);
    expect(graph.has("planner")).toBe(true);
  });

  it("coder agent declares handoffs to all skill agents", () => {
    const graph = buildAgentGraph();
    const coder = graph.get("coder")!;
    expect(coder.handoffs).toContain("tdd");
    expect(coder.handoffs).toContain("debugger");
    expect(coder.handoffs).toContain("reviewer");
    expect(coder.handoffs).toContain("pr-workflow");
    expect(coder.handoffs).toContain("planner");
  });

  it("includes the pr-reviewer agent", () => {
    const graph = buildAgentGraph();
    expect(graph.has("pr-reviewer")).toBe(true);
  });

  it("pr-reviewer has no handoffs", () => {
    const graph = buildAgentGraph();
    const prReviewer = graph.get("pr-reviewer")!;
    expect(prReviewer.handoffs).toEqual([]);
  });

  it("skill agents hand back to coder", () => {
    const graph = buildAgentGraph();
    const tdd = graph.get("tdd")!;
    expect(tdd.handoffs).toContain("coder");
  });
});
