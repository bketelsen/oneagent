import { defineAgent } from "one-agent-sdk";
import { REVIEWER_PROMPT } from "../prompts.js";

export const reviewerAgent = defineAgent({
  name: "reviewer",
  description: "Code review specialist",
  prompt: REVIEWER_PROMPT,
  handoffs: ["coder"],
});
