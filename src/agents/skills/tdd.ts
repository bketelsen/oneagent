import { defineAgent } from "one-agent-sdk";
import { TDD_PROMPT } from "../prompts.js";

export const tddAgent = defineAgent({
  name: "tdd",
  description: "TDD specialist — enforces test-driven development workflow",
  prompt: TDD_PROMPT,
  handoffs: ["coder"],
});
