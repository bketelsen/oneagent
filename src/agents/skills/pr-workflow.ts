import { defineAgent } from "one-agent-sdk";
import { PR_WORKFLOW_PROMPT } from "../prompts.js";

export const prWorkflowAgent = defineAgent({
  name: "pr-workflow",
  description: "PR creation and CI monitoring specialist",
  prompt: PR_WORKFLOW_PROMPT,
  handoffs: ["coder"],
});
