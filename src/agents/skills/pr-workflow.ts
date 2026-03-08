import { defineAgent } from "one-agent-sdk";
import { PR_WORKFLOW_PROMPT } from "../prompts.js";
import { setupWorkspaceTool } from "../../tools/workspace.js";
import { createPRTool } from "../../tools/github.js";
import { checkCIStatusTool } from "../../tools/ci.js";

export const prWorkflowAgent = defineAgent({
  name: "pr-workflow",
  description: "PR creation and CI monitoring specialist",
  prompt: PR_WORKFLOW_PROMPT,
  tools: [setupWorkspaceTool, createPRTool, checkCIStatusTool],
  handoffs: ["coder"],
});
