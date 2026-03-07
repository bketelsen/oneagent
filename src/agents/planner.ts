import { defineAgent } from "one-agent-sdk";
import type { ToolDef } from "one-agent-sdk";
import { PLANNER_PROMPT } from "./prompts.js";

export function createPlannerAgent(tools: ToolDef[]) {
  return defineAgent({
    name: "planner",
    description: "Planning specialist for complex issues",
    prompt: PLANNER_PROMPT,
    tools,
    handoffs: ["coder"],
  });
}

// Default export for backward compatibility with graph.ts
export const plannerAgent = defineAgent({
  name: "planner",
  description: "Planning specialist for complex issues",
  prompt: PLANNER_PROMPT,
  handoffs: ["coder"],
});
