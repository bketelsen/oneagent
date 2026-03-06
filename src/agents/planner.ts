import { defineAgent } from "one-agent-sdk";
import { PLANNER_PROMPT } from "./prompts.js";

export const plannerAgent = defineAgent({
  name: "planner",
  description: "Planning specialist for complex issues",
  prompt: PLANNER_PROMPT,
  handoffs: ["coder"],
});
