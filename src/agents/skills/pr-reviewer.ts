import { defineAgent } from "one-agent-sdk";
import { PR_REVIEWER_PROMPT } from "../prompts.js";

export const prReviewerAgent = defineAgent({
  name: "pr-reviewer",
  description: "Independent PR reviewer that submits GitHub reviews",
  prompt: PR_REVIEWER_PROMPT,
  handoffs: [],
});
