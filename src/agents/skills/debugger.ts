import { defineAgent } from "one-agent-sdk";
import { DEBUGGER_PROMPT } from "../prompts.js";

export const debuggerAgent = defineAgent({
  name: "debugger",
  description: "Systematic debugging specialist",
  prompt: DEBUGGER_PROMPT,
  handoffs: ["coder"],
});
