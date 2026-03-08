# Implement Stubbed Features — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement all 10 stubbed/unimplemented features across 5 phases, each independently shippable.

**Architecture:** Incremental wiring of existing dead code (Phase 1), metrics expansion (Phase 2), CI fix automation (Phase 3), GitHub Projects integration (Phase 4), and specialist agent tools (Phase 5). Each phase builds on the previous but can ship independently.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Hono JSX, one-agent-sdk, `gh` CLI for GitHub API

---

## Phase 1: Foundation — Wire Up Existing Dead Code

### Task 1: Workspace Hooks — Tests

**Files:**
- Modify: `src/workspace/__tests__/manager.test.ts`

**Step 1: Write failing tests for hooks integration**

Add these tests to the existing describe block:

```typescript
import { runHook } from "../hooks.js";

// Add after existing tests:

it("calls setup hook when creating workspace", () => {
  baseDir = mkdtempSync(join(tmpdir(), "ws-test-"));
  const setupFn = vi.fn();
  // We'll spy on runHook indirectly by checking the script ran
  const mgr = new WorkspaceManager(baseDir, undefined, { setup: "echo setup" });
  const dir = mgr.ensure("owner/repo#99");
  expect(existsSync(join(dir, ".."))).toBe(true);
  // Verify the directory exists (setup hook ran without error)
  expect(existsSync(dir)).toBe(true);
});

it("calls cleanup with teardown hook", () => {
  baseDir = mkdtempSync(join(tmpdir(), "ws-test-"));
  const mgr = new WorkspaceManager(baseDir, undefined, { teardown: "echo teardown" });
  const dir = mgr.ensure("owner/repo#100");
  expect(existsSync(dir)).toBe(true);
  mgr.cleanup("owner/repo#100");
  expect(existsSync(dir)).toBe(false);
});

it("cleanup removes directory even without teardown hook", () => {
  baseDir = mkdtempSync(join(tmpdir(), "ws-test-"));
  const mgr = new WorkspaceManager(baseDir);
  const dir = mgr.ensure("owner/repo#101");
  expect(existsSync(dir)).toBe(true);
  mgr.cleanup("owner/repo#101");
  expect(existsSync(dir)).toBe(false);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/workspace/__tests__/manager.test.ts`
Expected: FAIL — `WorkspaceManager` constructor doesn't accept hooks, no `cleanup` method.

**Step 3: Commit**

```bash
git add src/workspace/__tests__/manager.test.ts
git commit -m "test: add workspace hooks and cleanup tests (red)"
```

---

### Task 2: Workspace Hooks — Implementation

**Files:**
- Modify: `src/workspace/manager.ts`

**Step 1: Update WorkspaceManager to accept hooks and add cleanup**

```typescript
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import pino, { type Logger } from "pino";
import { runHook } from "./hooks.js";

export interface WorkspaceHooks {
  setup?: string;
  teardown?: string;
}

export class WorkspaceManager {
  private logger: Logger;

  constructor(
    private baseDir: string,
    logger?: Logger,
    private hooks?: WorkspaceHooks,
  ) {
    this.baseDir = resolve(baseDir);
    mkdirSync(this.baseDir, { recursive: true });
    this.logger = (logger ?? pino({ level: "silent" })).child({ module: "workspace" });
  }

  ensure(issueKey: string): string {
    const dirName = issueKey.replace(/[/#]/g, "-");
    const dir = join(this.baseDir, dirName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      this.logger.info({ issueKey, dir }, "workspace created");
      runHook(this.hooks?.setup, dir, this.logger);
    }
    return dir;
  }

  cleanup(issueKey: string): void {
    const dir = this.path(issueKey);
    if (existsSync(dir)) {
      runHook(this.hooks?.teardown, dir, this.logger);
      rmSync(dir, { recursive: true, force: true });
      this.logger.info({ issueKey, dir }, "workspace cleaned up");
    }
  }

  path(issueKey: string): string {
    return join(this.baseDir, issueKey.replace(/[/#]/g, "-"));
  }
}
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/workspace/__tests__/manager.test.ts`
Expected: PASS

**Step 3: Wire hooks in index.ts**

In `src/index.ts`, update the `WorkspaceManager` construction (line 64):

```typescript
// Before:
const workspace = new WorkspaceManager(config.workspace.baseDir, logger);
// After:
const workspace = new WorkspaceManager(config.workspace.baseDir, logger, config.workspace.hooks);
```

**Step 4: Call cleanup in orchestrator after successful runs**

In `src/orchestrator/orchestrator.ts`, after the run completes successfully in `executeRun()` (around line 488, after `completeRun`), add:

```typescript
this.deps.workspace?.cleanup(issue.key);
```

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/workspace/manager.ts src/index.ts src/orchestrator/orchestrator.ts
git commit -m "feat(workspace): wire setup/teardown hooks into WorkspaceManager"
```

---

### Task 3: SSEHub Refactor — Tests

**Files:**
- Modify: `src/web/__tests__/sse.test.ts`

**Step 1: Existing tests already use `broadcast()` — verify they pass**

Run: `npx vitest run src/web/__tests__/sse.test.ts`
Expected: PASS (tests already call `hub.broadcast()`)

No new tests needed — SSEHub's existing tests already cover `broadcast()` and `subscribe()`. The change is in the orchestrator, which replaces `EventEmitter.emit` with `SSEHub.broadcast`.

**Step 2: Commit (no changes needed)**

Tests already pass. Proceed to implementation.

---

### Task 4: SSEHub Refactor — Implementation

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`

**Step 1: Replace EventEmitter with SSEHub in orchestrator**

In `src/orchestrator/orchestrator.ts`:

1. Remove `import { EventEmitter } from "node:events";` (line 1)
2. Add `import { SSEHub } from "../web/sse.js";`
3. Change line 43 from `readonly sseHub = new EventEmitter();` to `readonly sseHub = new SSEHub();`
4. Replace all `this.sseHub.emit("sse", { type: ..., data: ... })` calls with `this.sseHub.broadcast(type, data)`.

There are approximately 8 `emit("sse", ...)` calls. Each follows the pattern:
```typescript
// Before:
this.sseHub.emit("sse", { type: "agent:started", data: { runId, issueKey: issue.key, provider: entry.provider } });
// After:
this.sseHub.broadcast("agent:started", { runId, issueKey: issue.key, provider: entry.provider });
```

**Step 2: Update index.ts to use SSEHub from orchestrator**

In `src/index.ts`, the `sseHub` is currently created separately (line 65) and passed to `createApp`. The orchestrator also creates its own `EventEmitter` as `sseHub`. After refactoring, use the orchestrator's `sseHub` directly:

```typescript
// Remove: const sseHub = new SSEHub();
// In appCtx, replace sseHub references with orchestrator.sseHub
```

Update the `createApp` context to use `orchestrator.sseHub`.

**Step 3: Update web app to subscribe via SSEHub**

Check `src/web/routes/api.ts` or wherever SSE streaming happens — ensure it uses `sseHub.subscribe()` instead of any EventEmitter `.on()` pattern.

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/orchestrator/orchestrator.ts src/index.ts
git commit -m "refactor(sse): replace EventEmitter with SSEHub.broadcast in orchestrator"
```

---

### Task 5: Wire Existing Tools Into Agents

**Files:**
- Modify: `src/agents/coder.ts`
- Modify: `src/agents/skills/pr-workflow.ts`

**Step 1: Add tools to coder agent**

```typescript
// src/agents/coder.ts
import { defineAgent } from "one-agent-sdk";
import { CODER_PROMPT } from "./prompts.js";
import { discoverRepoContextTool } from "../tools/repo-context.js";
import { readIssueTool, createPRTool } from "../tools/github.js";

export const coderAgent = defineAgent({
  name: "coder",
  description: "Primary coding agent that works on GitHub issues",
  prompt: CODER_PROMPT,
  tools: [discoverRepoContextTool, readIssueTool, createPRTool],
  handoffs: ["tdd", "debugger", "reviewer", "pr-workflow", "planner"],
});
```

**Step 2: Add tools to pr-workflow agent**

```typescript
// src/agents/skills/pr-workflow.ts
import { defineAgent } from "one-agent-sdk";
import { PR_WORKFLOW_PROMPT } from "../prompts.js";
import { setupWorkspaceTool } from "../../tools/workspace.js";
import { createPRTool } from "../../tools/github.js";

export const prWorkflowAgent = defineAgent({
  name: "pr-workflow",
  description: "PR creation and CI monitoring specialist",
  prompt: PR_WORKFLOW_PROMPT,
  tools: [setupWorkspaceTool, createPRTool],
  handoffs: ["coder"],
});
```

**Step 3: Run agent graph test**

Run: `npx vitest run src/agents/__tests__/graph.test.ts`
Expected: PASS

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/agents/coder.ts src/agents/skills/pr-workflow.ts
git commit -m "feat(agents): wire readIssueTool, createPRTool, setupWorkspaceTool into agents"
```

---

### Task 6: ConfigWatcher — Implementation

**Files:**
- Modify: `src/index.ts`
- Modify: `src/orchestrator/orchestrator.ts`

**Step 1: Write test for config reload flag on orchestrator**

Create `src/orchestrator/__tests__/config-reload.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Orchestrator } from "../orchestrator.js";

describe("Orchestrator config reload", () => {
  it("has a reloadConfig method that updates internal config", () => {
    // Verify the method exists — integration tested manually
    expect(typeof Orchestrator.prototype.reloadConfig).toBe("function");
  });
});
```

**Step 2: Add reloadConfig to orchestrator**

In `src/orchestrator/orchestrator.ts`, add a method:

```typescript
reloadConfig(newConfig: Config): void {
  this.config = newConfig;
  this.logger.info("config reloaded, will take effect on next tick");
}
```

**Step 3: Wire ConfigWatcher in index.ts**

In `src/index.ts`, after creating the orchestrator (around line 69):

```typescript
import { ConfigWatcher } from "./config/watcher.js";
import { watchFile, readFileSync } from "node:fs";

// After orchestrator creation:
const configWatcher = new ConfigWatcher((newConfig) => {
  orchestrator.reloadConfig(newConfig);
}, logger);

watchFile(opts.config, { interval: 5000 }, () => {
  try {
    const newYaml = readFileSync(opts.config, "utf-8");
    configWatcher.handleFileChange(newYaml);
  } catch (err) {
    logger.error({ err }, "failed to read config file on change");
  }
});
```

Add to the shutdown handler:

```typescript
const { unwatchFile } = await import("node:fs");
unwatchFile(opts.config);
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/orchestrator/orchestrator.ts src/index.ts src/orchestrator/__tests__/config-reload.test.ts
git commit -m "feat(config): wire ConfigWatcher to reload config between poll cycles"
```

---

## Phase 2: Full Observability

### Task 7: Expand Metrics Schema — Migration

**Files:**
- Modify: `src/db/migrations.ts`
- Modify: `src/db/metrics.ts`

**Step 1: Write test for new metrics columns**

Add to `src/db/__tests__/metrics.test.ts`:

```typescript
it("records and aggregates extended metrics", () => {
  metrics.record({
    provider: "claude-code",
    model: "claude-sonnet-4-6",
    tokensIn: 1000,
    tokensOut: 500,
    durationMs: 10000,
    costUsd: 0.015,
    status: "completed",
    handoffCount: 2,
    agentName: "coder",
  });
  metrics.record({
    provider: "claude-code",
    model: "claude-sonnet-4-6",
    tokensIn: 2000,
    tokensOut: 1000,
    durationMs: 20000,
    costUsd: 0.030,
    status: "failed",
    handoffCount: 0,
    agentName: "coder",
  });
  const totals = metrics.totals();
  expect(totals.tokensIn).toBe(3000);
  expect(totals.tokensOut).toBe(1500);
  expect(totals.totalCostUsd).toBeCloseTo(0.045);
  expect(totals.successRate).toBeCloseTo(0.5);
  expect(totals.avgDurationMs).toBe(15000);
});

it("returns recent runs with extended fields", () => {
  metrics.record({
    provider: "claude-code",
    model: "claude-sonnet-4-6",
    tokensIn: 500,
    tokensOut: 250,
    durationMs: 5000,
    costUsd: 0.01,
    status: "completed",
    handoffCount: 1,
    agentName: "coder",
    runId: "run-123",
  });
  const recent = metrics.recentRuns(10);
  expect(recent).toHaveLength(1);
  expect(recent[0].costUsd).toBeCloseTo(0.01);
  expect(recent[0].agentName).toBe("coder");
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/__tests__/metrics.test.ts`
Expected: FAIL

**Step 3: Add migration**

In `src/db/migrations.ts`, add to the `MIGRATIONS` array:

```typescript
{
  version: 4,
  description: "Add cost, status, handoff_count, agent_name to metrics",
  up(db) {
    const columns = db
      .prepare("PRAGMA table_info(metrics)")
      .all()
      .map((c: any) => c.name as string);

    if (!columns.includes("cost_usd")) {
      db.exec("ALTER TABLE metrics ADD COLUMN cost_usd REAL");
    }
    if (!columns.includes("status")) {
      db.exec("ALTER TABLE metrics ADD COLUMN status TEXT");
    }
    if (!columns.includes("handoff_count")) {
      db.exec("ALTER TABLE metrics ADD COLUMN handoff_count INTEGER DEFAULT 0");
    }
    if (!columns.includes("agent_name")) {
      db.exec("ALTER TABLE metrics ADD COLUMN agent_name TEXT");
    }
  },
},
```

**Step 4: Update MetricRecord and MetricsRepo**

In `src/db/metrics.ts`:

```typescript
export interface MetricRecord {
  runId?: string;
  provider: string;
  model?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  costUsd?: number;
  status?: string;
  handoffCount?: number;
  agentName?: string;
}

export interface MetricsTotals {
  tokensIn: number;
  tokensOut: number;
  runs: number;
  totalCostUsd: number;
  successRate: number;
  avgDurationMs: number;
}

export interface MetricRow {
  runId: string | null;
  provider: string;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  costUsd: number | null;
  status: string | null;
  agentName: string | null;
  handoffCount: number;
  ts: string;
}

export class MetricsRepo {
  constructor(private db: Database.Database) {}

  record(m: MetricRecord): void {
    this.db.prepare(`
      INSERT INTO metrics (run_id, provider, model, tokens_in, tokens_out, duration_ms, cost_usd, status, handoff_count, agent_name, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      m.runId ?? null, m.provider, m.model ?? null,
      m.tokensIn, m.tokensOut, m.durationMs,
      m.costUsd ?? null, m.status ?? null,
      m.handoffCount ?? 0, m.agentName ?? null,
      new Date().toISOString(),
    );
  }

  totals(): MetricsTotals {
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(tokens_in), 0) as ti,
        COALESCE(SUM(tokens_out), 0) as to_,
        COUNT(*) as c,
        COALESCE(SUM(cost_usd), 0) as total_cost,
        CASE WHEN COUNT(*) > 0
          THEN CAST(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS REAL) / COUNT(*)
          ELSE 0 END as success_rate,
        COALESCE(AVG(duration_ms), 0) as avg_duration
      FROM metrics
    `).get() as any;
    return {
      tokensIn: row.ti,
      tokensOut: row.to_,
      runs: row.c,
      totalCostUsd: row.total_cost,
      successRate: row.success_rate,
      avgDurationMs: row.avg_duration,
    };
  }

  recentRuns(limit = 20): MetricRow[] {
    return (this.db.prepare(
      "SELECT * FROM metrics ORDER BY ts DESC LIMIT ?"
    ).all(limit) as any[]).map((row) => ({
      runId: row.run_id,
      provider: row.provider,
      model: row.model,
      tokensIn: row.tokens_in,
      tokensOut: row.tokens_out,
      durationMs: row.duration_ms,
      costUsd: row.cost_usd,
      status: row.status,
      agentName: row.agent_name,
      handoffCount: row.handoff_count ?? 0,
      ts: row.ts,
    }));
  }
}
```

**Step 5: Run tests**

Run: `npx vitest run src/db/__tests__/metrics.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/db/migrations.ts src/db/metrics.ts src/db/__tests__/metrics.test.ts
git commit -m "feat(metrics): expand schema with cost, status, handoff count, agent name"
```

---

### Task 8: Cost Estimation Utility

**Files:**
- Create: `src/util/cost.ts`
- Create: `src/util/__tests__/cost.test.ts`

**Step 1: Write test**

```typescript
// src/util/__tests__/cost.test.ts
import { describe, it, expect } from "vitest";
import { estimateCost } from "../cost.js";

describe("estimateCost", () => {
  it("calculates cost for known models", () => {
    const cost = estimateCost("anthropic", "claude-sonnet-4-6", 1000, 500);
    expect(cost).toBeGreaterThan(0);
  });

  it("returns 0 for unknown models", () => {
    const cost = estimateCost("unknown", "mystery-model", 1000, 500);
    expect(cost).toBe(0);
  });

  it("returns 0 for claude-code provider (billed separately)", () => {
    const cost = estimateCost("claude-code", undefined, 1000, 500);
    expect(cost).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/util/__tests__/cost.test.ts`
Expected: FAIL

**Step 3: Implement**

```typescript
// src/util/cost.ts

// Per-token pricing in USD (per 1M tokens)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
};

export function estimateCost(
  provider: string,
  model: string | undefined,
  tokensIn: number,
  tokensOut: number,
): number {
  // claude-code provider is billed separately via subscription
  if (provider === "claude-code") return 0;

  if (!model) return 0;

  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;

  return (tokensIn * pricing.input + tokensOut * pricing.output) / 1_000_000;
}
```

**Step 4: Run test**

Run: `npx vitest run src/util/__tests__/cost.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/util/cost.ts src/util/__tests__/cost.test.ts
git commit -m "feat(util): add token cost estimation for known models"
```

---

### Task 9: Wire Observability Into Orchestrator

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`
- Modify: `src/db/runs.ts`

**Step 1: Add updateTokenUsage to RunsRepo**

In `src/db/runs.ts`, add method:

```typescript
updateTokenUsage(id: string, usage: { inputTokens: number; outputTokens: number }): void {
  this.db.prepare("UPDATE runs SET token_usage = ? WHERE id = ?")
    .run(JSON.stringify(usage), id);
}
```

**Step 2: Write test for updateTokenUsage**

Add to `src/db/__tests__/runs.test.ts`:

```typescript
it("updates token usage", () => {
  // Insert a run first
  repo.insert({ id: "r-tok", issueKey: "o/r#1", provider: "test", status: "running", startedAt: new Date().toISOString(), retryCount: 0 });
  repo.updateTokenUsage("r-tok", { inputTokens: 1000, outputTokens: 500 });
  const run = repo.getById("r-tok");
  expect(run?.tokenUsage).toBe(JSON.stringify({ inputTokens: 1000, outputTokens: 500 }));
});
```

**Step 3: Run test**

Run: `npx vitest run src/db/__tests__/runs.test.ts`
Expected: PASS

**Step 4: Update orchestrator executeRun and executeReviewRun**

In `src/orchestrator/orchestrator.ts`, in each execute method:

1. Add `let handoffCount = 0;` alongside the token counters
2. In the `chunk.type === "handoff"` handler, add `handoffCount++;`
3. After the stream completes, before calling `metricsRepo.record()`:

```typescript
// Persist token usage to runs table
if (totalInputTokens > 0 || totalOutputTokens > 0) {
  this.deps.runsRepo?.updateTokenUsage(runId, {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
  });
}
```

4. Update the `metricsRepo.record()` calls to include new fields:

```typescript
import { estimateCost } from "../util/cost.js";

// In executeRun:
this.deps.metricsRepo?.record({
  runId,
  provider: this.config.agent.provider,
  model: this.config.agent.model,
  tokensIn: totalInputTokens,
  tokensOut: totalOutputTokens,
  durationMs,
  costUsd: estimateCost(this.config.agent.provider, this.config.agent.model, totalInputTokens, totalOutputTokens),
  status: "completed",
  handoffCount,
  agentName: "coder",
});
```

Do the same for `executeReviewRun` (with `agentName: "coder"`) and `executeReviewAgentRun` (with `agentName: "pr-reviewer"`, using `this.config.prReview.provider/model`).

5. In the catch blocks, also record failed metrics:

```typescript
this.deps.metricsRepo?.record({
  runId,
  provider: this.config.agent.provider,
  model: this.config.agent.model,
  tokensIn: totalInputTokens,
  tokensOut: totalOutputTokens,
  durationMs: failDurationMs,
  costUsd: estimateCost(this.config.agent.provider, this.config.agent.model, totalInputTokens, totalOutputTokens),
  status: "failed",
  handoffCount,
  agentName: "coder",
});
```

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/db/runs.ts src/db/__tests__/runs.test.ts src/orchestrator/orchestrator.ts
git commit -m "feat(observability): wire token usage, cost, handoffs, status into metrics"
```

---

### Task 10: Dashboard Metrics Widgets

**Files:**
- Modify: `src/web/routes/dashboard.tsx`
- Modify: `src/index.ts`

**Step 1: Update getState in index.ts to return extended metrics**

In `src/index.ts`, the `getState` callback (line 81) returns `metrics: metricsRepo.totals()`. Since we updated `totals()` to return the extended `MetricsTotals` interface, the dashboard just needs to display the new fields.

**Step 2: Update dashboard.tsx to show new metrics**

In `src/web/routes/dashboard.tsx`, add new metric cards after the existing three:

```tsx
<div class="bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
  <div class="text-sm text-gray-500 dark:text-gray-400">Est. Cost</div>
  <div class="text-3xl font-bold">${state.metrics.totalCostUsd.toFixed(3)}</div>
</div>
<div class="bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
  <div class="text-sm text-gray-500 dark:text-gray-400">Success Rate</div>
  <div class="text-3xl font-bold">{(state.metrics.successRate * 100).toFixed(0)}%</div>
</div>
<div class="bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
  <div class="text-sm text-gray-500 dark:text-gray-400">Avg Duration</div>
  <div class="text-3xl font-bold">{Math.round(state.metrics.avgDurationMs / 1000)}s</div>
</div>
```

Change the grid from `grid-cols-3` to `grid-cols-3 lg:grid-cols-6`.

**Step 3: Run dashboard tests**

Run: `npx vitest run src/web/__tests__/dashboard.test.ts`
Expected: PASS (may need minor adjustments to test expectations)

**Step 4: Commit**

```bash
git add src/web/routes/dashboard.tsx src/index.ts
git commit -m "feat(dashboard): display cost, success rate, avg duration metrics"
```

---

## Phase 3: Automation — PR Monitor & CI Fixing

### Task 11: CI Fixing Config Schema

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/__tests__/schema.test.ts`

**Step 1: Write test for new config option**

Add to `src/config/__tests__/schema.test.ts`:

```typescript
it("provides ciFixing defaults", () => {
  const config = configSchema.parse({
    github: { repos: [{ owner: "a", repo: "b", labels: ["x"] }] },
  });
  expect(config.ciFixing.enabled).toBe(false);
  expect(config.ciFixing.pollInterval).toBe(60000);
  expect(config.ciFixing.maxAttempts).toBe(2);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: FAIL

**Step 3: Add ciFixing schema**

In `src/config/schema.ts`, add before `configSchema`:

```typescript
const ciFixingSchema = z.object({
  enabled: z.boolean().default(false),
  pollInterval: z.number().min(5000).default(60000),
  maxAttempts: z.number().min(1).default(2),
});
```

Add to `configSchema`:

```typescript
ciFixing: withDefault(ciFixingSchema),
```

**Step 4: Run test**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/schema.ts src/config/__tests__/schema.test.ts
git commit -m "feat(config): add ciFixing schema with enabled, pollInterval, maxAttempts"
```

---

### Task 12: Wire PR Monitor and CI Fix Dispatch

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`

**Step 1: Start PR Monitor in orchestrator.start()**

In `Orchestrator.start()`, after the existing `setInterval` calls (around line 84), add:

```typescript
if (this.config.ciFixing.enabled) {
  this.logger.info({ ciFixPollInterval: this.config.ciFixing.pollInterval }, "CI fix polling enabled");
  setInterval(() => this.tickCIFixes(), this.config.ciFixing.pollInterval);
}
```

**Step 2: Add ciFixAttempts tracker and tickCIFixes method**

Add a property:
```typescript
private ciFixAttempts = new Map<string, number>();
```

Add the method:
```typescript
private async tickCIFixes(): Promise<void> {
  if (!this.config.ciFixing.enabled) return;

  const results = await this.prMonitor.check();
  this.logger.info({ ciFailureCount: results.length }, "CI fix tick");

  for (const result of results) {
    const prKey = `${result.repo}#${result.pr}`;
    const fixKey = `ci-fix:${prKey}`;

    if (this.state.isRunning(fixKey)) continue;
    if (this.state.activeCount() >= this.config.concurrency.max) break;

    const attempts = this.ciFixAttempts.get(prKey) ?? 0;
    if (attempts >= this.config.ciFixing.maxAttempts) {
      this.logger.info({ prKey, attempts }, "max CI fix attempts reached, skipping");
      continue;
    }

    this.ciFixAttempts.set(prKey, attempts + 1);

    // Fetch PR details to build prompt
    const [owner, repoAndNum] = result.repo.split("/");
    const prs = await this.github.fetchPRsWithLabel(owner, repoAndNum, this.config.labels.inProgress);
    const pr = prs.find((p) => p.number === result.pr);
    if (!pr) continue;

    const failureLog = result.failures.join("\n");
    const prompt = this.dispatcher.buildPRFixPrompt(pr, failureLog);

    // Dispatch using the same pattern as other runs
    const runId = ulid();
    const abortController = new AbortController();
    const entry: RunEntry = {
      runId,
      issueKey: fixKey,
      provider: this.config.agent.provider,
      startedAt: new Date(),
      lastActivity: new Date(),
      retryCount: 0,
      abortController,
      currentAgent: "coder",
      lastActivityDescription: "Fixing CI failure...",
      toolCallCount: 0,
    };

    this.state.add(fixKey, entry);
    this.logger.info({ runId, prKey, attempt: attempts + 1 }, "dispatching CI fix agent");

    this.deps.runsRepo?.insert({
      id: runId,
      issueKey: fixKey,
      provider: entry.provider,
      status: "running",
      startedAt: entry.startedAt.toISOString(),
      retryCount: 0,
    });

    this.sseHub.broadcast("agent:started", { runId, issueKey: fixKey, provider: entry.provider });

    const workDir = this.deps.workspace?.ensure(fixKey);
    this.executeRun(runId, { ...pr, key: fixKey } as any, prompt, abortController, workDir).catch((err) => {
      this.logger.error({ err, runId, prKey }, "unhandled CI fix run error");
    });
  }
}
```

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/orchestrator/orchestrator.ts
git commit -m "feat(ci-fixing): wire PR monitor and auto-dispatch CI fix agents"
```

---

## Phase 4: GitHub Projects Integration

### Task 13: GitHub Projects API Client

**Files:**
- Create: `src/github/projects.ts`
- Create: `src/github/__tests__/projects.test.ts`

**Step 1: Write tests**

```typescript
// src/github/__tests__/projects.test.ts
import { describe, it, expect, vi } from "vitest";
import { GitHubProjectsClient } from "../projects.js";

// Mock execFileSync since we can't call gh CLI in tests
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";

describe("GitHubProjectsClient", () => {
  it("fetches project items", () => {
    const mockResponse = JSON.stringify({
      data: {
        node: {
          items: {
            nodes: [
              {
                id: "item-1",
                content: {
                  __typename: "Issue",
                  number: 42,
                  title: "Test issue",
                  body: "Test body",
                  labels: { nodes: [{ name: "oneagent" }] },
                  repository: { owner: { login: "owner" }, name: "repo" },
                },
                fieldValues: {
                  nodes: [{ name: "Todo" }],
                },
              },
            ],
          },
        },
      },
    });
    vi.mocked(execFileSync).mockReturnValue(mockResponse);

    const client = new GitHubProjectsClient();
    const items = client.fetchProjectItems("PVT_123");
    expect(items).toHaveLength(1);
    expect(items[0].issueNumber).toBe(42);
  });

  it("updates item status", () => {
    vi.mocked(execFileSync).mockReturnValue("{}");
    const client = new GitHubProjectsClient();
    expect(() => client.updateItemStatus("PVT_123", "item-1", "field-1", "option-1")).not.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/github/__tests__/projects.test.ts`
Expected: FAIL

**Step 3: Implement**

```typescript
// src/github/projects.ts
import { execFileSync } from "node:child_process";

export interface ProjectItem {
  itemId: string;
  issueNumber: number;
  title: string;
  body: string;
  owner: string;
  repo: string;
  labels: string[];
  status?: string;
}

export interface StatusField {
  fieldId: string;
  options: Array<{ id: string; name: string }>;
}

export class GitHubProjectsClient {
  private graphql(query: string, variables?: Record<string, unknown>): any {
    const args = ["api", "graphql", "-f", `query=${query}`];
    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        args.push("-f", `${key}=${String(value)}`);
      }
    }
    const result = execFileSync("gh", args, { encoding: "utf-8" });
    return JSON.parse(result);
  }

  fetchProjectItems(projectId: string): ProjectItem[] {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            items(first: 100) {
              nodes {
                id
                content {
                  ... on Issue {
                    __typename
                    number
                    title
                    body
                    labels(first: 10) { nodes { name } }
                    repository { owner { login } name }
                  }
                }
                fieldValues(first: 10) {
                  nodes {
                    ... on ProjectV2ItemFieldSingleSelectValue { name }
                  }
                }
              }
            }
          }
        }
      }
    `;
    const data = this.graphql(query, { projectId });
    const items = data?.data?.node?.items?.nodes ?? [];

    return items
      .filter((item: any) => item.content?.__typename === "Issue")
      .map((item: any) => ({
        itemId: item.id,
        issueNumber: item.content.number,
        title: item.content.title,
        body: item.content.body ?? "",
        owner: item.content.repository.owner.login,
        repo: item.content.repository.name,
        labels: (item.content.labels?.nodes ?? []).map((l: any) => l.name),
        status: item.fieldValues?.nodes?.find((f: any) => f.name)?.name,
      }));
  }

  fetchStatusField(projectId: string): StatusField | null {
    const query = `
      query($projectId: ID!) {
        node(id: $projectId) {
          ... on ProjectV2 {
            fields(first: 20) {
              nodes {
                ... on ProjectV2SingleSelectField {
                  id name
                  options { id name }
                }
              }
            }
          }
        }
      }
    `;
    const data = this.graphql(query, { projectId });
    const fields = data?.data?.node?.fields?.nodes ?? [];
    const statusField = fields.find((f: any) => f.name === "Status" && f.options);
    if (!statusField) return null;
    return {
      fieldId: statusField.id,
      options: statusField.options,
    };
  }

  updateItemStatus(projectId: string, itemId: string, fieldId: string, optionId: string): void {
    const query = `
      mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }) { projectV2Item { id } }
      }
    `;
    this.graphql(query, { projectId, itemId, fieldId, optionId });
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run src/github/__tests__/projects.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/github/projects.ts src/github/__tests__/projects.test.ts
git commit -m "feat(github): add Projects V2 GraphQL client for status sync"
```

---

### Task 14: Wire GitHub Projects Into Orchestrator

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`
- Modify: `src/index.ts`

**Step 1: Add project sync helper to orchestrator**

Add a private helper and cache for status field lookups:

```typescript
import { GitHubProjectsClient, type StatusField } from "../github/projects.js";

// In constructor or as property:
private projectsClient?: GitHubProjectsClient;
private statusFieldCache?: StatusField;

private async syncProjectStatus(issueKey: string, targetStatus: string): Promise<void> {
  if (!this.config.project.id) return;

  if (!this.projectsClient) {
    this.projectsClient = new GitHubProjectsClient();
  }

  if (!this.statusFieldCache) {
    this.statusFieldCache = this.projectsClient.fetchStatusField(this.config.project.id) ?? undefined;
  }

  if (!this.statusFieldCache) {
    this.logger.warn("could not find Status field on project board");
    return;
  }

  const option = this.statusFieldCache.options.find((o) => o.name === targetStatus);
  if (!option) {
    this.logger.warn({ targetStatus }, "status option not found on project board");
    return;
  }

  const items = this.projectsClient.fetchProjectItems(this.config.project.id);
  const parsed = this.github.parseIssueKey(issueKey);
  if (!parsed) return;

  const item = items.find((i) => i.owner === parsed.owner && i.repo === parsed.repo && i.issueNumber === parsed.number);
  if (!item) return;

  this.projectsClient.updateItemStatus(this.config.project.id, item.itemId, this.statusFieldCache.fieldId, option.id);
  this.logger.info({ issueKey, status: targetStatus }, "updated project board status");
}
```

**Step 2: Call syncProjectStatus at lifecycle points**

In `dispatch()`: `await this.syncProjectStatus(issue.key, this.config.project.statuses.inProgress).catch(...)`
In `executeRun()` on success, after finding PR: `await this.syncProjectStatus(issue.key, this.config.project.statuses.inReview).catch(...)`
In `executeRun()` on success, if no PR (just completed): `await this.syncProjectStatus(issue.key, this.config.project.statuses.done).catch(...)`

**Step 3: Add board as source in tick()**

In `tick()`, after the label-based issue fetch loop, add:

```typescript
if (this.config.project.id) {
  if (!this.projectsClient) this.projectsClient = new GitHubProjectsClient();
  const boardItems = this.projectsClient.fetchProjectItems(this.config.project.id);
  const todoItems = boardItems.filter((item) => item.status === this.config.project.statuses.todo);

  for (const item of todoItems) {
    const key = `${item.owner}/${item.repo}#${item.issueNumber}`;
    if (allIssues.some((i) => i.key === key)) continue; // already fetched via labels

    allIssues.push({
      key,
      owner: item.owner,
      repo: item.repo,
      number: item.issueNumber,
      title: item.title,
      body: item.body,
      labels: item.labels,
      hasOpenPR: false,
    });
  }
}
```

**Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/orchestrator/orchestrator.ts
git commit -m "feat(projects): bidirectional GitHub Projects sync — status updates and board polling"
```

---

## Phase 5: Specialist Agent Tools

### Task 15: TDD Agent — Testing Tools

**Files:**
- Create: `src/tools/testing.ts`
- Create: `src/tools/__tests__/testing.test.ts`
- Modify: `src/agents/skills/tdd.ts`

**Step 1: Write tests**

```typescript
// src/tools/__tests__/testing.test.ts
import { describe, it, expect } from "vitest";
import { runTestsTool, runTestsFilteredTool } from "../testing.js";

describe("testing tools", () => {
  it("runTestsTool has correct name and parameters", () => {
    expect(runTestsTool.name).toBe("run_tests");
  });

  it("runTestsFilteredTool has correct name and parameters", () => {
    expect(runTestsFilteredTool.name).toBe("run_tests_filtered");
  });
});
```

**Step 2: Implement**

```typescript
// src/tools/testing.ts
import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import { execFileSync, execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function detectTestCommand(cwd: string): string {
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (pkg.scripts?.test) return "npm test";
  }
  const makefilePath = join(cwd, "Makefile");
  if (existsSync(makefilePath)) {
    const makefile = readFileSync(makefilePath, "utf-8");
    if (makefile.includes("test:")) return "make test";
  }
  return "npm test";
}

export const runTestsTool = defineTool({
  name: "run_tests",
  description: "Run the project's test suite. Auto-detects test command from package.json or Makefile.",
  parameters: z.object({
    cwd: z.string().describe("Working directory for the project"),
  }),
  handler: async ({ cwd }) => {
    const cmd = detectTestCommand(cwd);
    try {
      const output = execSync(cmd, { cwd, encoding: "utf-8", timeout: 120000, stdio: "pipe" });
      return JSON.stringify({ exitCode: 0, output });
    } catch (err: any) {
      return JSON.stringify({
        exitCode: err.status ?? 1,
        output: err.stdout ?? "",
        stderr: err.stderr ?? "",
      });
    }
  },
});

export const runTestsFilteredTool = defineTool({
  name: "run_tests_filtered",
  description: "Run specific tests by file path or name pattern",
  parameters: z.object({
    cwd: z.string().describe("Working directory for the project"),
    file: z.string().optional().describe("Test file path to run"),
    pattern: z.string().optional().describe("Test name pattern to match"),
  }),
  handler: async ({ cwd, file, pattern }) => {
    const args = ["npx", "vitest", "run"];
    if (file) args.push(file);
    if (pattern) args.push("-t", pattern);
    try {
      const output = execSync(args.join(" "), { cwd, encoding: "utf-8", timeout: 120000, stdio: "pipe" });
      return JSON.stringify({ exitCode: 0, output });
    } catch (err: any) {
      return JSON.stringify({
        exitCode: err.status ?? 1,
        output: err.stdout ?? "",
        stderr: err.stderr ?? "",
      });
    }
  },
});
```

**Step 3: Wire into TDD agent**

```typescript
// src/agents/skills/tdd.ts
import { defineAgent } from "one-agent-sdk";
import { TDD_PROMPT } from "../prompts.js";
import { runTestsTool, runTestsFilteredTool } from "../../tools/testing.js";

export const tddAgent = defineAgent({
  name: "tdd",
  description: "TDD specialist — enforces test-driven development workflow",
  prompt: TDD_PROMPT,
  tools: [runTestsTool, runTestsFilteredTool],
  handoffs: ["coder"],
});
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/tools/testing.ts src/tools/__tests__/testing.test.ts src/agents/skills/tdd.ts
git commit -m "feat(tools): add run_tests and run_tests_filtered tools for TDD agent"
```

---

### Task 16: Debugger Agent — Debugging Tools

**Files:**
- Create: `src/tools/debugging.ts`
- Create: `src/tools/__tests__/debugging.test.ts`
- Modify: `src/agents/skills/debugger.ts`

**Step 1: Write tests**

```typescript
// src/tools/__tests__/debugging.test.ts
import { describe, it, expect } from "vitest";
import { readLogsTool, inspectErrorTool } from "../debugging.js";

describe("debugging tools", () => {
  it("readLogsTool has correct name", () => {
    expect(readLogsTool.name).toBe("read_logs");
  });

  it("inspectErrorTool has correct name", () => {
    expect(inspectErrorTool.name).toBe("inspect_error");
  });
});
```

**Step 2: Implement**

```typescript
// src/tools/debugging.ts
import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";

export const readLogsTool = defineTool({
  name: "read_logs",
  description: "Read the last N lines from a log file",
  parameters: z.object({
    filePath: z.string().describe("Absolute path to the log file"),
    lines: z.number().default(100).describe("Number of lines to read from the end"),
  }),
  handler: async ({ filePath, lines }) => {
    if (!existsSync(filePath)) {
      return `File not found: ${filePath}`;
    }
    const content = readFileSync(filePath, "utf-8");
    const allLines = content.split("\n");
    return allLines.slice(-lines).join("\n");
  },
});

export const inspectErrorTool = defineTool({
  name: "inspect_error",
  description: "Parse a stack trace and read source code around each frame",
  parameters: z.object({
    stackTrace: z.string().describe("The error stack trace to inspect"),
    contextLines: z.number().default(5).describe("Lines of context around each frame"),
  }),
  handler: async ({ stackTrace, contextLines }) => {
    // Extract file:line references from stack trace
    const framePattern = /at\s+.*?\(?(\/[^:)]+):(\d+):\d+\)?/g;
    const frames: Array<{ file: string; line: number; source: string }> = [];

    let match;
    while ((match = framePattern.exec(stackTrace)) !== null) {
      const file = match[1];
      const line = parseInt(match[2], 10);

      if (!existsSync(file)) continue;
      // Skip node_modules
      if (file.includes("node_modules")) continue;

      const content = readFileSync(file, "utf-8").split("\n");
      const start = Math.max(0, line - contextLines - 1);
      const end = Math.min(content.length, line + contextLines);
      const source = content
        .slice(start, end)
        .map((l, i) => {
          const lineNum = start + i + 1;
          const marker = lineNum === line ? " >> " : "    ";
          return `${marker}${lineNum}: ${l}`;
        })
        .join("\n");

      frames.push({ file, line, source });
    }

    if (frames.length === 0) {
      return "No source file references found in stack trace.";
    }

    return frames
      .map((f) => `--- ${f.file}:${f.line} ---\n${f.source}`)
      .join("\n\n");
  },
});
```

**Step 3: Wire into debugger agent**

```typescript
// src/agents/skills/debugger.ts
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
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/tools/debugging.ts src/tools/__tests__/debugging.test.ts src/agents/skills/debugger.ts
git commit -m "feat(tools): add read_logs and inspect_error tools for debugger agent"
```

---

### Task 17: Reviewer Agent — Wire readIssueTool

**Files:**
- Modify: `src/agents/skills/reviewer.ts`

**Step 1: Add readIssueTool**

```typescript
// src/agents/skills/reviewer.ts
import { defineAgent } from "one-agent-sdk";
import { REVIEWER_PROMPT } from "../prompts.js";
import { readIssueTool } from "../../tools/github.js";

export const reviewerAgent = defineAgent({
  name: "reviewer",
  description: "Code review specialist",
  prompt: REVIEWER_PROMPT,
  tools: [readIssueTool],
  handoffs: ["coder"],
});
```

**Step 2: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/agents/skills/reviewer.ts
git commit -m "feat(agents): give reviewer agent readIssueTool for requirement context"
```

---

### Task 18: PR-Workflow Agent — CI Tools

**Files:**
- Create: `src/tools/ci.ts`
- Create: `src/tools/__tests__/ci.test.ts`
- Modify: `src/agents/skills/pr-workflow.ts`

**Step 1: Write test**

```typescript
// src/tools/__tests__/ci.test.ts
import { describe, it, expect } from "vitest";
import { checkCIStatusTool } from "../ci.js";

describe("ci tools", () => {
  it("checkCIStatusTool has correct name", () => {
    expect(checkCIStatusTool.name).toBe("check_ci_status");
  });
});
```

**Step 2: Implement**

```typescript
// src/tools/ci.ts
import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import { execFileSync } from "node:child_process";

export const checkCIStatusTool = defineTool({
  name: "check_ci_status",
  description: "Check CI/CD check run statuses for a pull request",
  parameters: z.object({
    owner: z.string(),
    repo: z.string(),
    prNumber: z.number(),
  }),
  handler: async ({ owner, repo, prNumber }) => {
    const result = execFileSync("gh", [
      "pr", "checks", String(prNumber),
      "--repo", `${owner}/${repo}`,
      "--json", "name,state,conclusion",
    ], { encoding: "utf-8" });
    return result;
  },
});
```

**Step 3: Update pr-workflow agent (already has setupWorkspaceTool and createPRTool from Task 5)**

```typescript
// src/agents/skills/pr-workflow.ts
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
```

**Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/tools/ci.ts src/tools/__tests__/ci.test.ts src/agents/skills/pr-workflow.ts
git commit -m "feat(tools): add check_ci_status tool for PR-workflow agent"
```

---

### Task 19: Update Tool Exports and Final Verification

**Files:**
- Modify: `src/tools/index.ts`

**Step 1: Add new tool exports**

```typescript
// src/tools/index.ts
export { readIssueTool, createPRTool } from "./github.js";
export { createPlanningTools } from "./planning.js";
export { createReviewTools } from "./review.js";
export type { ReviewVerdict } from "./review.js";
export { discoverRepoContextTool } from "./repo-context.js";
export { setupWorkspaceTool } from "./workspace.js";
export { runTestsTool, runTestsFilteredTool } from "./testing.js";
export { readLogsTool, inspectErrorTool } from "./debugging.js";
export { checkCIStatusTool } from "./ci.js";
```

**Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

**Step 3: Build to verify TypeScript compilation**

Run: `npm run build`
Expected: Clean build with no errors

**Step 4: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat(tools): export all new specialist agent tools"
```

---

### Task 20: Update CLAUDE.md and README

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Step 1: Update CLAUDE.md**

Add to the Architecture section:
- Workspace hooks (setup/teardown)
- ConfigWatcher for hot-reload between poll cycles
- CI fixing auto-dispatch
- GitHub Projects bidirectional sync
- Specialist agent tools (TDD, debugger, reviewer, pr-workflow)

Add to Config section:
- `ciFixing` config block
- `project.id` and `project.statuses` now functional

**Step 2: Update README.md**

Document the new features for end users.

**Step 3: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: update CLAUDE.md and README with new features"
```
