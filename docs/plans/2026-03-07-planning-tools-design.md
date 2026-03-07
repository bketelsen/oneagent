# Planning Tools Design: Superpowers-Style Interactive Planning

**Date:** 2026-03-07
**Status:** Approved

## Goal

Replace the shallow planning tools (`create_plan`, `refine_plan`) with a superpowers-inspired interactive planning system in the web UI. The end product of a planning session is a set of GitHub issues with detailed implementation steps and proper dependency graphs (`Depends on #N`), each scoped to be independently testable and mergeable.

## Architecture

### Planning Agent

Uses one-agent-sdk's `run()` with a structured prompt (superpowers-style: ask one clarifying question at a time, propose 2-3 approaches, build detailed plans). The agent has three tools:

### Tools

#### `create_plan`

Creates a structured plan and persists it to `PlanningRepo`.

Parameters:
- `title` (string) — plan title
- `description` (string) — high-level summary
- `phases` (array of Phase objects)

Each Phase contains:
- `name` (string)
- `tasks` (array of Task objects)

Each Task contains:
- `id` (string) — local ID for dependency references within the plan
- `title` (string) — becomes GitHub issue title
- `body` (string) — detailed implementation steps with exact file paths, code snippets, and verification commands; becomes GitHub issue body
- `complexity` (enum: low | medium | high)
- `dependsOn` (string[]) — local IDs of prerequisite tasks
- `acceptanceCriteria` (string[])

Returns: formatted markdown rendering of the plan.

#### `refine_plan`

Modifies an existing plan. Supports operations: reorder tasks, adjust scope, add/remove phases, update dependencies, edit task details.

Parameters:
- `sessionId` (string) — identifies which plan to modify
- `operations` (array of operations, each with `type` and relevant fields)

Operation types:
- `add_phase` — add a new phase with tasks
- `remove_phase` — remove a phase by name
- `add_task` — add a task to an existing phase
- `remove_task` — remove a task by ID
- `update_task` — update fields on an existing task
- `reorder` — change task/phase ordering
- `update_dependencies` — modify dependency graph

Returns: updated plan as formatted markdown.

#### `publish_plan`

Takes the finalized plan and creates GitHub issues.

Parameters:
- `sessionId` (string) — identifies which plan to publish

Behavior:
1. Creates issues in dependency order (leaves first) so parent issues can reference child issue numbers
2. Each task becomes a GitHub issue with:
   - Title from `task.title`
   - Body from `task.body` + acceptance criteria + complexity label
   - `Depends on #N` lines for dependencies (using actual issue numbers)
   - The configured eligible label (from `oneagent.yaml`) so the orchestrator picks them up
3. Updates the plan in PlanningRepo with `status: "published"` and maps `task.id` -> `issueNumber`
4. Returns summary with links to all created issues

### Data Model

```typescript
interface Plan {
  title: string;
  description: string;
  phases: Phase[];
  status: "draft" | "approved" | "published";
}

interface Phase {
  name: string;
  tasks: Task[];
}

interface Task {
  id: string;
  title: string;
  body: string;
  complexity: "low" | "medium" | "high";
  dependsOn: string[];
  acceptanceCriteria: string[];
  issueNumber?: number; // populated after publish
}

interface PlanningSession {
  id: string;
  issueKey?: string;
  plan?: Plan;
  history: PlanningMessage[];
  createdAt: string;
  updatedAt: string;
}
```

The existing `PlanningRepo` schema stores `history` as JSON text. Extend to also store the `plan` as a separate JSON column so it can be rendered independently of chat history.

### Planning Session Flow

Structured conversation (superpowers-style):

1. Human describes the feature/problem
2. Agent explores: asks one clarifying question at a time
3. Agent proposes 2-3 approaches with trade-offs and a recommendation
4. Human picks an approach
5. Agent calls `create_plan` with detailed phases and tasks
6. Human reviews the plan, gives feedback
7. Agent calls `refine_plan` to update
8. Repeat 6-7 until satisfied
9. Human approves -> agent calls `publish_plan` -> GitHub issues created with dependency graph

### Agent Prompt

The planner agent prompt should be rewritten to enforce this structured approach:
- Always ask one question at a time
- Explore: purpose, constraints, existing code, success criteria
- Propose 2-3 approaches with trade-offs before building a plan
- Build plans with bite-sized tasks (each independently testable/mergeable)
- Each task body must include: exact file paths, implementation details, verification steps
- Use `Depends on` references for task ordering
- Only call `publish_plan` when the human explicitly approves

### Web UI Changes

The planning routes at `/planning/` already exist with a chat interface. Changes needed:

1. **Plan viewer panel** — alongside the chat, render the current plan state (phases, tasks, dependencies as a visual graph or tree)
2. **Publish button** — triggers `publish_plan` when the human is satisfied
3. **Published state** — show links to created GitHub issues after publishing
4. **SSE streaming** — connect the chat to the planner agent via SSE for real-time responses

### Backend Changes

1. **Connect chat handler** — the `onChat` stub in `src/index.ts` needs to invoke the planner agent via one-agent-sdk's `run()` and stream responses
2. **Plan API endpoint** — `GET /api/v1/planning/:id/plan` to fetch the current plan state for the viewer panel
3. **Publish endpoint** — `POST /api/v1/planning/:id/publish` to trigger issue creation (or let the agent do it via the tool)

## Files to Modify

- `src/tools/planning.ts` — rewrite with new tool definitions
- `src/agents/planner.ts` — add `tools` array, update prompt
- `src/agents/prompts.ts` — rewrite `PLANNER_PROMPT`
- `src/db/planning.ts` — extend schema and repo for plan storage
- `src/db/migrations.ts` — add migration for `plan` column
- `src/web/routes/planning.tsx` — add plan viewer, publish button
- `src/index.ts` — connect the chat handler to the planner agent

## Files to Create

- None anticipated — all changes are to existing files

## Dependencies

- `one-agent-sdk` — already used for agent execution
- `@octokit/rest` — already used via `GitHubClient` for issue creation
- No new dependencies needed

## Out of Scope

- Automated planning triggered by the orchestrator (existing planner agent handoff is separate)
- Plan templates or reusable plan fragments
- Plan versioning / undo history beyond what chat history provides
