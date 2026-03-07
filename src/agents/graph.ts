import { coderAgent } from "./coder.js";
import { tddAgent } from "./skills/tdd.js";
import { debuggerAgent } from "./skills/debugger.js";
import { reviewerAgent } from "./skills/reviewer.js";
import { prWorkflowAgent } from "./skills/pr-workflow.js";
import { plannerAgent } from "./planner.js";

/** Definition of a single agent in the orchestration graph. */
export interface AgentDef {
  /** Unique identifier used to reference this agent in handoffs. */
  name: string;
  /** Short human-readable summary of the agent's purpose. */
  description: string;
  /** System prompt sent to the model when this agent is active. */
  prompt: string;
  /** Names of agents this agent can hand off to. */
  handoffs?: string[];
}

/**
 * Build the agent graph as a name-keyed map.
 *
 * Registers every known agent and returns a `Map<name, AgentDef>` so callers
 * can look up agents by name for routing and handoff resolution.
 */
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
