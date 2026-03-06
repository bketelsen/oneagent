import { defineAgent } from "one-agent-sdk";
import { CODER_PROMPT } from "./prompts.js";

export const coderAgent = defineAgent({
  name: "coder",
  description: "Primary coding agent that works on GitHub issues",
  prompt: CODER_PROMPT,
  handoffs: ["tdd", "debugger", "reviewer", "pr-workflow", "planner"],
});
