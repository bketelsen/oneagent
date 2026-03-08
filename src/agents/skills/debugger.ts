import { defineAgent } from "one-agent-sdk";
import { DEBUGGER_PROMPT } from "../prompts.js";
import { readLogsTool, inspectErrorTool } from "../../tools/debugging.js";

export const debuggerAgent = defineAgent({
  name: "debugger",
  description: "Systematic debugging specialist",
  prompt: DEBUGGER_PROMPT,
  tools: [readLogsTool, inspectErrorTool],
  handoffs: ["coder"],
});
