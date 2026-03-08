import { defineAgent } from "one-agent-sdk";
import { REVIEWER_PROMPT } from "../prompts.js";
import { readIssueTool } from "../../tools/github.js";

export const reviewerAgent = defineAgent({
  name: "reviewer",
  description: "Code review specialist",
  prompt: REVIEWER_PROMPT,
  tools: [readIssueTool],
  handoffs: ["coder"],
});
