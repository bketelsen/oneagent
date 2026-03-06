import { coderAgent } from "./coder.js";
import { tddAgent } from "./skills/tdd.js";
import { debuggerAgent } from "./skills/debugger.js";
import { reviewerAgent } from "./skills/reviewer.js";
import { prWorkflowAgent } from "./skills/pr-workflow.js";
import { plannerAgent } from "./planner.js";

export type AgentDef = { name: string; handoffs?: string[]; [key: string]: unknown };

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
