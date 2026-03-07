import { defineAgent } from "one-agent-sdk";
import { CODER_PROMPT } from "./prompts.js";
import { discoverRepoContextTool } from "../tools/repo-context.js";

export const coderAgent = defineAgent({
  name: "coder",
  description: "Primary coding agent that works on GitHub issues",
  prompt: CODER_PROMPT,
  tools: [discoverRepoContextTool],
  handoffs: ["tdd", "debugger", "reviewer", "pr-workflow", "planner"],
});
