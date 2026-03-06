import { coderAgent } from "./coder.js";
import { tddAgent } from "./skills/tdd.js";
import { debuggerAgent } from "./skills/debugger.js";
import { reviewerAgent } from "./skills/reviewer.js";
import { prWorkflowAgent } from "./skills/pr-workflow.js";
import { plannerAgent } from "./planner.js";

export interface AgentDef {
  name: string;
  description: string;
  prompt: string;
  handoffs?: string[];
}

export function buildAgentGraph(): Map<string, AgentDef> {
  const agents: AgentDef[] = [
    coderAgent,
    tddAgent,
    debuggerAgent,
    reviewerAgent,
    prWorkflowAgent,
    plannerAgent,
  ];
  return new Map(agents.map((a) => [a.name, a]));
}
