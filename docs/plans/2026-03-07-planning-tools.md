# Planning Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace shallow planning tools with superpowers-style interactive planning that produces GitHub issues with dependency graphs.

**Architecture:** Factory-pattern planning tools that close over PlanningRepo and use `gh` CLI for GitHub issue creation (matching existing tool patterns). The planner agent gets a structured prompt enforcing one-question-at-a-time conversation flow. The web UI adds a plan viewer panel alongside the chat and a chat API endpoint.

**Tech Stack:** one-agent-sdk (defineTool, defineAgent), Zod v4, Hono JSX, better-sqlite3, gh CLI

---

### Task 1: Add plan column to planning_sessions table

**Files:**
- Modify: `src/db/migrations.ts`
- Modify: `src/db/schema.ts`

**Step 1: Add migration for plan column**

In `src/db/migrations.ts`, add a new migration to the `MIGRATIONS` array after the existing version 1 migration:

```typescript
{
  version: 2,
  description: "Add plan column to planning_sessions",
  up(db) {
    const columns = db
      .prepare("PRAGMA table_info(planning_sessions)")
      .all()
      .map((c: any) => c.name as string);

    if (!columns.includes("plan")) {
      db.exec("ALTER TABLE planning_sessions ADD COLUMN plan TEXT");
    }
    if (!columns.includes("status")) {
      db.exec("ALTER TABLE planning_sessions ADD COLUMN status TEXT DEFAULT 'draft'");
    }
  },
},
```

**Step 2: Update initial schema**

In `src/db/schema.ts`, add `plan TEXT` and `status TEXT DEFAULT 'draft'` columns to the `planning_sessions` CREATE TABLE statement (after `history TEXT NOT NULL`).

**Step 3: Run build to verify**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/db/migrations.ts src/db/schema.ts
git commit -m "feat: add plan and status columns to planning_sessions"
```

---

### Task 2: Extend PlanningRepo with plan storage

**Files:**
- Modify: `src/db/planning.ts`
- Create: `src/db/__tests__/planning.test.ts`

**Step 1: Write the failing test**

Create `src/db/__tests__/planning.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { PlanningRepo } from "../planning.js";
import { runMigrations } from "../migrations.js";

describe("PlanningRepo", () => {
  let db: Database.Database;
  let repo: PlanningRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new PlanningRepo(db);
  });

  it("saves and loads a plan", () => {
    const plan = {
      title: "Test Plan",
      description: "A test plan",
      phases: [{
        name: "Phase 1",
        tasks: [{
          id: "t1",
          title: "Task 1",
          body: "Do the thing",
          complexity: "low" as const,
          dependsOn: [],
          acceptanceCriteria: ["It works"],
        }],
      }],
      status: "draft" as const,
    };
    repo.savePlan("session-1", plan);
    const loaded = repo.loadPlan("session-1");
    expect(loaded).toEqual(plan);
  });

  it("returns null for missing plan", () => {
    repo.save("session-2", []);
    expect(repo.loadPlan("session-2")).toBeNull();
  });

  it("updates plan status", () => {
    const plan = {
      title: "Test",
      description: "desc",
      phases: [],
      status: "draft" as const,
    };
    repo.savePlan("session-3", plan);
    repo.updatePlanStatus("session-3", "published");
    const loaded = repo.loadPlan("session-3");
    expect(loaded?.status).toBe("published");
  });

  it("list includes plan status", () => {
    repo.save("session-4", []);
    const plan = { title: "T", description: "d", phases: [], status: "draft" as const };
    repo.savePlan("session-4", plan);
    const sessions = repo.list();
    expect(sessions[0].status).toBe("draft");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/planning.test.ts`
Expected: FAIL — `savePlan` is not a function

**Step 3: Add Plan types and methods to PlanningRepo**

In `src/db/planning.ts`, add these types before the class:

```typescript
export interface PlanTask {
  id: string;
  title: string;
  body: string;
  complexity: "low" | "medium" | "high";
  dependsOn: string[];
  acceptanceCriteria: string[];
  issueNumber?: number;
}

export interface PlanPhase {
  name: string;
  tasks: PlanTask[];
}

export interface Plan {
  title: string;
  description: string;
  phases: PlanPhase[];
  status: "draft" | "approved" | "published";
}
```

Update `PlanningSessionRow` to include `status`:

```typescript
export interface PlanningSessionRow {
  id: string;
  issueKey: string | null;
  status: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Add these methods to the `PlanningRepo` class:

```typescript
savePlan(id: string, plan: Plan): void {
  const now = new Date().toISOString();
  const planJson = JSON.stringify(plan);
  this.db.prepare(`
    INSERT INTO planning_sessions (id, created_at, updated_at, history, plan, status)
    VALUES (?, ?, ?, '[]', ?, ?)
    ON CONFLICT(id) DO UPDATE SET plan = ?, status = ?, updated_at = ?
  `).run(id, now, now, planJson, plan.status, planJson, plan.status, now);
}

loadPlan(id: string): Plan | null {
  const row = this.db.prepare("SELECT plan FROM planning_sessions WHERE id = ?").get(id) as any;
  if (!row?.plan) return null;
  return JSON.parse(row.plan);
}

updatePlanStatus(id: string, status: string): void {
  const plan = this.loadPlan(id);
  if (plan) {
    plan.status = status as Plan["status"];
    this.savePlan(id, plan);
  }
}
```

Update the `list()` method to include status:

```typescript
list(): PlanningSessionRow[] {
  return (this.db.prepare("SELECT id, issue_key, status, created_at, updated_at FROM planning_sessions ORDER BY updated_at DESC").all() as any[]).map((r) => ({
    id: r.id,
    issueKey: r.issue_key,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/planning.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/planning.ts src/db/__tests__/planning.test.ts
git commit -m "feat: extend PlanningRepo with plan storage and status tracking"
```

---

### Task 3: Rewrite planning tools as factory functions

**Files:**
- Modify: `src/tools/planning.ts`
- Create: `src/tools/__tests__/planning.test.ts`

**Step 1: Write the failing test**

Create `src/tools/__tests__/planning.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { PlanningRepo } from "../../db/planning.js";
import { runMigrations } from "../../db/migrations.js";
import { createPlanningTools } from "../planning.js";

describe("planning tools", () => {
  let db: Database.Database;
  let repo: PlanningRepo;
  let tools: ReturnType<typeof createPlanningTools>;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new PlanningRepo(db);
    tools = createPlanningTools({ planningRepo: repo, repoConfig: { owner: "test", repo: "test", labels: ["oneagent"] } });
  });

  it("create_plan persists and returns markdown", async () => {
    const result = await tools.createPlan.handler({
      sessionId: "s1",
      title: "My Plan",
      description: "Test plan",
      phases: [{
        name: "Phase 1",
        tasks: [{
          id: "t1",
          title: "Task 1",
          body: "Implementation details",
          complexity: "low",
          dependsOn: [],
          acceptanceCriteria: ["Works"],
        }],
      }],
    });

    expect(result).toContain("My Plan");
    expect(result).toContain("Task 1");

    const plan = repo.loadPlan("s1");
    expect(plan).not.toBeNull();
    expect(plan!.title).toBe("My Plan");
    expect(plan!.status).toBe("draft");
  });

  it("refine_plan updates an existing plan", async () => {
    // First create
    await tools.createPlan.handler({
      sessionId: "s2",
      title: "Original",
      description: "desc",
      phases: [{ name: "P1", tasks: [{ id: "t1", title: "Task 1", body: "body", complexity: "low", dependsOn: [], acceptanceCriteria: [] }] }],
    });

    // Then refine
    const result = await tools.refinePlan.handler({
      sessionId: "s2",
      operations: [
        { type: "add_task", phaseName: "P1", task: { id: "t2", title: "Task 2", body: "new body", complexity: "medium", dependsOn: ["t1"], acceptanceCriteria: ["tested"] } },
      ],
    });

    expect(result).toContain("Task 2");
    const plan = repo.loadPlan("s2");
    expect(plan!.phases[0].tasks).toHaveLength(2);
    expect(plan!.phases[0].tasks[1].dependsOn).toEqual(["t1"]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/__tests__/planning.test.ts`
Expected: FAIL — `createPlanningTools` is not a function

**Step 3: Rewrite planning tools**

Replace the contents of `src/tools/planning.ts`:

```typescript
import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import type { PlanningRepo, Plan, PlanPhase, PlanTask } from "../db/planning.js";

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  complexity: z.enum(["low", "medium", "high"]),
  dependsOn: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
});

const phaseSchema = z.object({
  name: z.string(),
  tasks: z.array(taskSchema),
});

const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_phase"), phase: phaseSchema }),
  z.object({ type: z.literal("remove_phase"), phaseName: z.string() }),
  z.object({ type: z.literal("add_task"), phaseName: z.string(), task: taskSchema }),
  z.object({ type: z.literal("remove_task"), taskId: z.string() }),
  z.object({ type: z.literal("update_task"), taskId: z.string(), updates: taskSchema.partial().omit({ id: true }) }),
]);

interface PlanningToolsConfig {
  planningRepo: PlanningRepo;
  repoConfig: { owner: string; repo: string; labels: string[] };
}

function formatPlan(plan: Plan): string {
  const lines: string[] = [`# ${plan.title}`, "", plan.description, ""];
  for (const phase of plan.phases) {
    lines.push(`## ${phase.name}`, "");
    for (const task of phase.tasks) {
      const deps = task.dependsOn.length > 0 ? ` (depends on: ${task.dependsOn.join(", ")})` : "";
      lines.push(`### [${task.complexity}] ${task.title}${deps}`, "");
      lines.push(task.body, "");
      if (task.acceptanceCriteria.length > 0) {
        lines.push("**Acceptance Criteria:**");
        for (const ac of task.acceptanceCriteria) {
          lines.push(`- ${ac}`);
        }
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}

export function createPlanningTools(config: PlanningToolsConfig) {
  const { planningRepo, repoConfig } = config;

  const createPlan = defineTool({
    name: "create_plan",
    description: "Create a structured implementation plan with phases and tasks. Each task will become a GitHub issue when published.",
    parameters: z.object({
      sessionId: z.string(),
      title: z.string(),
      description: z.string(),
      phases: z.array(phaseSchema),
    }),
    handler: async ({ sessionId, title, description, phases }) => {
      const plan: Plan = { title, description, phases, status: "draft" };
      planningRepo.savePlan(sessionId, plan);
      return formatPlan(plan);
    },
  });

  const refinePlan = defineTool({
    name: "refine_plan",
    description: "Modify an existing plan. Supports adding/removing phases and tasks, and updating task details.",
    parameters: z.object({
      sessionId: z.string(),
      operations: z.array(operationSchema),
    }),
    handler: async ({ sessionId, operations }) => {
      const plan = planningRepo.loadPlan(sessionId);
      if (!plan) return "Error: No plan found for this session. Use create_plan first.";

      for (const op of operations) {
        switch (op.type) {
          case "add_phase":
            plan.phases.push(op.phase);
            break;
          case "remove_phase":
            plan.phases = plan.phases.filter((p) => p.name !== op.phaseName);
            break;
          case "add_task": {
            const phase = plan.phases.find((p) => p.name === op.phaseName);
            if (!phase) return `Error: Phase "${op.phaseName}" not found.`;
            phase.tasks.push(op.task);
            break;
          }
          case "remove_task":
            for (const phase of plan.phases) {
              phase.tasks = phase.tasks.filter((t) => t.id !== op.taskId);
            }
            break;
          case "update_task":
            for (const phase of plan.phases) {
              const task = phase.tasks.find((t) => t.id === op.taskId);
              if (task) {
                Object.assign(task, op.updates);
                break;
              }
            }
            break;
        }
      }

      planningRepo.savePlan(sessionId, plan);
      return formatPlan(plan);
    },
  });

  const publishPlan = defineTool({
    name: "publish_plan",
    description: "Publish the finalized plan as GitHub issues with dependency graph. Each task becomes an issue with 'Depends on #N' references.",
    parameters: z.object({
      sessionId: z.string(),
    }),
    handler: async ({ sessionId }) => {
      const plan = planningRepo.loadPlan(sessionId);
      if (!plan) return "Error: No plan found for this session.";
      if (plan.status === "published") return "Error: Plan already published.";

      const { owner, repo, labels } = repoConfig;
      const label = labels[0];
      const { execFileSync } = await import("node:child_process");

      // Topologically sort tasks: create leaves (no dependents) first
      const allTasks = plan.phases.flatMap((p) => p.tasks);
      const idToTask = new Map(allTasks.map((t) => [t.id, t]));
      const idToIssueNumber = new Map<string, number>();

      // Sort: tasks with no dependencies first, then tasks whose deps are satisfied
      const sorted: PlanTask[] = [];
      const remaining = new Set(allTasks.map((t) => t.id));
      while (remaining.size > 0) {
        let progress = false;
        for (const id of remaining) {
          const task = idToTask.get(id)!;
          if (task.dependsOn.every((dep) => !remaining.has(dep))) {
            sorted.push(task);
            remaining.delete(id);
            progress = true;
          }
        }
        if (!progress) {
          // Circular dependency — add remaining tasks as-is
          for (const id of remaining) sorted.push(idToTask.get(id)!);
          break;
        }
      }

      const createdIssues: string[] = [];
      for (const task of sorted) {
        // Build issue body
        const bodyParts = [task.body];
        if (task.acceptanceCriteria.length > 0) {
          bodyParts.push("\n## Acceptance Criteria\n" + task.acceptanceCriteria.map((ac) => `- [ ] ${ac}`).join("\n"));
        }
        if (task.dependsOn.length > 0) {
          const depLines = task.dependsOn
            .map((dep) => {
              const num = idToIssueNumber.get(dep);
              return num ? `Depends on #${num}` : `Depends on: ${dep} (not yet created)`;
            })
            .join("\n");
          bodyParts.push("\n## Dependencies\n" + depLines);
        }
        bodyParts.push(`\n_Complexity: ${task.complexity}_`);

        const body = bodyParts.join("\n");
        const result = execFileSync("gh", [
          "issue", "create",
          "--repo", `${owner}/${repo}`,
          "--title", task.title,
          "--body", body,
          "--label", label,
        ], { encoding: "utf-8" });

        // gh issue create outputs the URL like https://github.com/owner/repo/issues/123
        const issueUrlMatch = result.match(/\/issues\/(\d+)/);
        if (issueUrlMatch) {
          const issueNumber = parseInt(issueUrlMatch[1], 10);
          idToIssueNumber.set(task.id, issueNumber);
          task.issueNumber = issueNumber;
          createdIssues.push(`#${issueNumber}: ${task.title}`);
        }
      }

      plan.status = "published";
      planningRepo.savePlan(sessionId, plan);

      return `Published ${createdIssues.length} issues:\n${createdIssues.map((i) => `- ${i}`).join("\n")}`;
    },
  });

  return { createPlan, refinePlan, publishPlan };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/tools/__tests__/planning.test.ts`
Expected: PASS (create_plan and refine_plan tests pass; publish_plan is not tested here because it calls `gh` CLI)

**Step 5: Run build**

Run: `npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add src/tools/planning.ts src/tools/__tests__/planning.test.ts
git commit -m "feat: rewrite planning tools as factory functions with persistence"
```

---

### Task 4: Rewrite planner agent prompt and wire up tools

**Files:**
- Modify: `src/agents/prompts.ts`
- Modify: `src/agents/planner.ts`

**Step 1: Rewrite PLANNER_PROMPT in prompts.ts**

Replace the `PLANNER_PROMPT` export (lines 63-72) with:

```typescript
export const PLANNER_PROMPT = `You are a planning specialist that helps break down complex work into independently testable, mergeable GitHub issues.

## Your Conversation Flow

Follow this structured approach strictly:

### Phase 1: Understand
- Ask ONE clarifying question at a time
- Explore: purpose, constraints, existing code affected, success criteria
- Do not propose solutions yet — understand the problem first

### Phase 2: Propose Approaches
- When you have enough context, propose 2-3 approaches
- For each approach: brief description, trade-offs, and estimated task count
- Include your recommendation and reasoning
- Wait for the human to choose before proceeding

### Phase 3: Build the Plan
- Call create_plan with detailed phases and tasks
- Each task MUST be independently testable and mergeable
- Each task body MUST include:
  - Exact file paths to create or modify
  - Implementation details with code snippets
  - Verification steps (test commands, expected output)
- Use dependsOn to express ordering constraints between tasks

### Phase 4: Refine
- Present the plan and ask for feedback
- Use refine_plan to incorporate changes
- Repeat until the human is satisfied

### Phase 5: Publish
- Only call publish_plan when the human explicitly approves
- Each task becomes a GitHub issue with "Depends on #N" for dependency ordering

## Rules
- ONE question per message during Phase 1
- Prefer multiple-choice questions when possible
- Each task should be scoped to ~2-5 minutes of implementation work
- YAGNI — do not add unnecessary features or phases
- Never call publish_plan without explicit human approval`;
```

**Step 2: Update planner agent to accept tools dynamically**

Replace `src/agents/planner.ts` with:

```typescript
import { defineAgent } from "one-agent-sdk";
import type { ToolDef } from "one-agent-sdk";
import { PLANNER_PROMPT } from "./prompts.js";

export function createPlannerAgent(tools: ToolDef<any>[]) {
  return defineAgent({
    name: "planner",
    description: "Planning specialist for complex issues",
    prompt: PLANNER_PROMPT,
    tools,
    handoffs: ["coder"],
  });
}

// Default export for backward compatibility with graph.ts
export const plannerAgent = defineAgent({
  name: "planner",
  description: "Planning specialist for complex issues",
  prompt: PLANNER_PROMPT,
  handoffs: ["coder"],
});
```

**Step 3: Run build to verify**

Run: `npm run build`
Expected: No errors

**Step 4: Run existing tests to verify no regressions**

Run: `npm test`
Expected: All existing tests pass

**Step 5: Commit**

```bash
git add src/agents/prompts.ts src/agents/planner.ts
git commit -m "feat: rewrite planner prompt for structured planning flow"
```

---

### Task 5: Add planning chat API endpoint

**Files:**
- Modify: `src/web/routes/planning.tsx`
- Modify: `src/db/planning.ts` (add `PlanningContext` updates)

**Step 1: Add chat POST endpoint and plan GET endpoint to planning route**

In `src/web/routes/planning.tsx`, add these routes inside the `planningRoute` function (before `return route`):

```typescript
// Chat API endpoint
route.post("/:id/chat", async (c) => {
  const id = c.req.param("id");
  const { message } = await c.req.json<{ message: string }>();

  // Save user message
  const history = ctx.planningRepo.load(id);
  history.push({ role: "user", content: message });

  // Collect response from generator
  let response = "";
  for await (const chunk of ctx.onChat(id, message)) {
    response += chunk;
  }

  // Save assistant response
  history.push({ role: "assistant", content: response });
  ctx.planningRepo.save(id, history);

  // Return plan alongside the response if one exists
  const plan = ctx.planningRepo.loadPlan(id);
  return c.json({ response, plan });
});

// Plan state endpoint
route.get("/:id/plan", (c) => {
  const id = c.req.param("id");
  const plan = ctx.planningRepo.loadPlan(id);
  if (!plan) return c.json({ plan: null });
  return c.json({ plan });
});
```

**Step 2: Update PlanningContext interface**

Add `loadPlan` to the imports if needed and ensure the `PlanningContext` interface includes the repo methods needed. The existing interface is sufficient since `planningRepo` already has `loadPlan` and `savePlan` from Task 2.

**Step 3: Run build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/web/routes/planning.tsx
git commit -m "feat: add planning chat and plan state API endpoints"
```

---

### Task 6: Update planning web UI with plan viewer panel

**Files:**
- Modify: `src/web/routes/planning.tsx`

**Step 1: Update the session detail page (GET /:id route)**

Replace the existing `route.get("/:id", ...)` handler with an enhanced version that includes a plan viewer panel. The layout should be a two-column view: chat on the left, plan on the right.

Update the JSX for the `/:id` route:

```tsx
route.get("/:id", (c) => {
  const id = c.req.param("id");
  const history = ctx.planningRepo.load(id);
  const plan = ctx.planningRepo.loadPlan(id);
  return c.html(
    <Layout title={`Planning: ${id}`}>
      <h1 class="text-xl font-bold mb-4">Planning Session</h1>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Chat panel */}
        <div>
          <h2 class="text-lg font-semibold mb-2">Chat</h2>
          <div id="chat" class="bg-gray-800 rounded p-4 max-h-[60vh] overflow-y-auto mb-4 space-y-3">
            {history.map((msg) => (
              <div class={msg.role === "user" ? "text-blue-300" : "text-gray-300"}>
                <span class="font-semibold">{msg.role}:</span> {msg.content}
              </div>
            ))}
          </div>
          <form id="chat-form" class="flex gap-2">
            <input type="text" name="message" placeholder="Type a message..."
              class="flex-1 bg-gray-700 rounded px-4 py-2 text-sm" autocomplete="off" />
            <button type="submit" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm">Send</button>
          </form>
        </div>

        {/* Plan viewer panel */}
        <div>
          <div class="flex justify-between items-center mb-2">
            <h2 class="text-lg font-semibold">Plan</h2>
            {plan?.status === "draft" && (
              <button id="publish-btn" class="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-sm">
                Publish to GitHub
              </button>
            )}
            {plan?.status === "published" && (
              <span class="text-green-400 text-sm">Published</span>
            )}
          </div>
          <div id="plan-viewer" class="bg-gray-800 rounded p-4 max-h-[60vh] overflow-y-auto">
            {plan ? renderPlan(plan) : <p class="text-gray-500">No plan yet. Start chatting to build one.</p>}
          </div>
        </div>
      </div>
      {/* Client-side JS for chat and publish */}
      <script dangerouslySetInnerHTML={{ __html: planningScript(id) }} />
    </Layout>
  );
});
```

Add helper functions before the route definition:

```tsx
function renderPlan(plan: any) {
  return (
    <div class="space-y-4">
      <h3 class="text-lg font-bold">{plan.title}</h3>
      <p class="text-gray-400">{plan.description}</p>
      {plan.phases.map((phase: any) => (
        <div class="border border-gray-700 rounded p-3">
          <h4 class="font-semibold text-blue-300 mb-2">{phase.name}</h4>
          <div class="space-y-2">
            {phase.tasks.map((task: any) => (
              <div class="bg-gray-900 rounded p-2">
                <div class="flex items-center gap-2">
                  <span class={`text-xs px-1.5 py-0.5 rounded ${
                    task.complexity === "low" ? "bg-green-900 text-green-300" :
                    task.complexity === "medium" ? "bg-yellow-900 text-yellow-300" :
                    "bg-red-900 text-red-300"
                  }`}>{task.complexity}</span>
                  <span class="font-medium">{task.title}</span>
                  {task.issueNumber && (
                    <a href={`https://github.com/${task.issueNumber}`} class="text-blue-400 text-sm">#{task.issueNumber}</a>
                  )}
                </div>
                {task.dependsOn.length > 0 && (
                  <div class="text-xs text-gray-500 mt-1">Depends on: {task.dependsOn.join(", ")}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function planningScript(id: string): string {
  return `
    const chatEl = document.getElementById('chat');
    const form = document.getElementById('chat-form');
    const planViewer = document.getElementById('plan-viewer');
    const publishBtn = document.getElementById('publish-btn');

    form.onsubmit = async (e) => {
      e.preventDefault();
      const input = form.message;
      const msg = input.value;
      if (!msg.trim()) return;
      const userDiv = document.createElement('div');
      userDiv.className = 'text-blue-300';
      userDiv.innerHTML = '<span class="font-semibold">user:</span> ' + msg;
      chatEl.appendChild(userDiv);
      input.value = '';
      const res = await fetch('/planning/${id}/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      const assistDiv = document.createElement('div');
      assistDiv.className = 'text-gray-300';
      assistDiv.innerHTML = '<span class="font-semibold">assistant:</span> ' + (data.response || '');
      chatEl.appendChild(assistDiv);
      chatEl.scrollTop = chatEl.scrollHeight;
      // Refresh plan viewer if plan data returned
      if (data.plan) {
        location.reload();
      }
    };

    if (publishBtn) {
      publishBtn.onclick = async () => {
        if (!confirm('Publish all tasks as GitHub issues?')) return;
        publishBtn.disabled = true;
        publishBtn.textContent = 'Publishing...';
        const res = await fetch('/planning/${id}/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Please publish the plan now.' }),
        });
        const data = await res.json();
        alert(data.response || 'Published!');
        location.reload();
      };
    }
  `;
}
```

Note: The chat form now posts to `/planning/${id}/chat` (the route within the planning route) instead of `/api/v1/planning/${id}/chat`.

**Step 2: Run build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/web/routes/planning.tsx
git commit -m "feat: add plan viewer panel and publish button to planning UI"
```

---

### Task 7: Connect planning chat to planner agent in index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Wire up the planning tools and chat handler**

In `src/index.ts`, replace the planning stub (lines 123-128) with a real implementation.

Add import at the top:

```typescript
import { createPlanningTools } from "./tools/planning.js";
import { createPlannerAgent } from "./agents/planner.js";
import { run } from "one-agent-sdk";
```

Replace the `planning` section in the `appCtx`:

```typescript
planning: {
  planningRepo,
  onChat: async function* (sessionId: string, message: string) {
    const firstRepo = config.github.repos[0];
    const planningTools = createPlanningTools({
      planningRepo,
      repoConfig: firstRepo,
    });
    const agent = createPlannerAgent([
      planningTools.createPlan,
      planningTools.refinePlan,
      planningTools.publishPlan,
    ]);

    // Load history for context
    const history = planningRepo.load(sessionId);
    const messages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));
    messages.push({ role: "user", content: message });

    // Inject sessionId into the system prompt so tools know which session to use
    const prompt = agent.prompt + `\n\nIMPORTANT: The current planning session ID is "${sessionId}". Always use this sessionId when calling create_plan, refine_plan, or publish_plan.`;

    let fullResponse = "";
    for await (const chunk of run({
      agent,
      messages,
      systemPrompt: prompt,
      provider: config.agent.provider,
      model: config.agent.model,
    })) {
      if (chunk.type === "text") {
        fullResponse += chunk.content;
        yield chunk.content;
      }
    }
  },
},
```

Note: The exact shape of the `run()` call depends on the one-agent-sdk API. The key pattern is:
- Load chat history from PlanningRepo
- Append the new user message
- Run the planner agent with the tools
- Stream text chunks back via the generator
- The tools handle persistence internally

**Step 2: Remove the now-unused static import of `plannerAgent`**

Check if `plannerAgent` is imported elsewhere in index.ts. If not, no changes needed since the graph still uses the static version.

**Step 3: Run build**

Run: `npm run build`
Expected: No errors. If the `run()` API shape doesn't match, adjust based on actual one-agent-sdk types.

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: connect planning chat to planner agent with tools"
```

---

### Task 8: Update session list to show plan status

**Files:**
- Modify: `src/web/routes/planning.tsx`

**Step 1: Update the list page**

In the `route.get("/", ...)` handler, update the session list items to show plan status:

```tsx
{sessions.map((s: PlanningSessionRow) => (
  <a href={`/planning/${s.id}`} class="block bg-gray-800 rounded p-4 hover:bg-gray-700">
    <div class="flex justify-between items-center">
      <div class="font-medium">{s.id}</div>
      {s.status && (
        <span class={`text-xs px-2 py-0.5 rounded ${
          s.status === "published" ? "bg-green-900 text-green-300" :
          s.status === "approved" ? "bg-blue-900 text-blue-300" :
          "bg-gray-700 text-gray-400"
        }`}>{s.status}</span>
      )}
    </div>
    <div class="text-gray-500 text-sm">{s.issueKey ?? "No issue"} — {s.updatedAt}</div>
  </a>
))}
```

**Step 2: Run build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/web/routes/planning.tsx
git commit -m "feat: show plan status badges on planning session list"
```

---

### Task 9: Run full test suite and verify build

**Files:** None (verification only)

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run build**

Run: `npm run build`
Expected: Clean build with no errors

**Step 3: Verify the planning flow manually (if running)**

Run: `npm start`
- Navigate to http://localhost:3000/planning/
- Click "New Session"
- Verify the two-column layout renders (chat left, plan right)
- Verify the plan panel shows "No plan yet"

---

### Task 10: Update CLAUDE.md and README.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Step 1: Update CLAUDE.md**

Add to the Architecture section under "Key modules" a bullet for the planning tools:

```
- `src/tools/planning.ts` — Factory function `createPlanningTools()` returns `create_plan`, `refine_plan`, `publish_plan` tools that persist plans to PlanningRepo and publish as GitHub issues via `gh` CLI.
```

Update the planner agent description:

```
The `planner` agent uses a structured superpowers-style prompt (one question at a time, propose approaches, build detailed plans) with three tools: `create_plan`, `refine_plan`, `publish_plan`. Plans are persisted in SQLite and can be published as GitHub issues with dependency graphs.
```

**Step 2: Update README.md**

Add a section about the planning feature describing the interactive planning workflow and how published plans become GitHub issues.

**Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document planning tools and interactive planning workflow"
```
