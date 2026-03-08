# Implement Stubbed & Unimplemented Features

**Date:** 2026-03-07
**Status:** Approved

## Problem

A comprehensive audit of the codebase found 10 features that are stubbed out, partially implemented, or have dead infrastructure. This design covers implementing all of them in 5 incremental phases.

## Findings

### Dead Infrastructure (built but never wired)
1. **Workspace hooks** — `runHook()` in `workspace/hooks.ts` exported but never called; `WorkspaceManager` ignores hooks config
2. **MetricsRepo.record()** — partially wired (called in orchestrator for token tracking) but `token_usage` column on `runs` table never populated
3. **ConfigWatcher** — class in `config/watcher.ts` defined and exported, never instantiated
4. **GitHub/Workspace tools** — `readIssueTool`, `createPRTool`, `setupWorkspaceTool` exported but never given to any agent
5. **SSEHub.broadcast()** — method defined but orchestrator uses `EventEmitter.emit()` instead

### Partially Implemented
6. **PR Monitor / CI fixing** — detection logic works, `start()` and `startReviewPolling()` never called, comment says "Dispatch would be wired through orchestrator"
7. **Specialist agents** — TDD, debugger, reviewer, pr-workflow agents have prompts and handoff declarations but no tools

### Unused Config
8. **project.id** — defined in schema, never read
9. **project.statuses** — defined with defaults (Todo/In Progress/In Review/Done), never used

## Approach

Incremental delivery in 5 phases. Each phase is independently shippable and testable.

---

## Phase 1: Foundation — Wire Up Existing Dead Code

### 1a. Workspace Hooks

Modify `WorkspaceManager` to accept hooks config and call `runHook()`.

- Constructor accepts optional `hooks: { setup?: string; teardown?: string }`
- `ensure()` calls `runHook(hooks.setup, dir, logger)` after creating the directory
- New `cleanup(issueKey)` method calls `runHook(hooks.teardown, dir, logger)` then removes the directory
- Orchestrator calls `cleanup()` after a run completes successfully
- `runHook()` already handles both shell commands and script paths via `execSync`

**Files:** `src/workspace/manager.ts`, `src/orchestrator/orchestrator.ts`, `src/index.ts`

### 1b. ConfigWatcher

Instantiate `ConfigWatcher` in `index.ts`, watch the config file with `fs.watchFile()`.

- On change, `handleFileChange()` validates the new YAML
- Set a `configDirty` flag on the orchestrator
- At the start of each `tick()`, if `configDirty`, swap in the new config and log the reload
- No mid-run config changes — only applied between poll cycles

**Files:** `src/index.ts`, `src/orchestrator/orchestrator.ts`, `src/config/watcher.ts`

### 1c. SSEHub Refactor

Replace `EventEmitter` usage in orchestrator with `SSEHub.broadcast()`.

- Orchestrator holds `SSEHub` instead of `EventEmitter`
- All `this.sseHub.emit("sse", {...})` calls become `this.sseHub.broadcast(type, data)`
- Web routes subscribe via `sseHub.subscribe()` (already implemented)
- Remove `EventEmitter` import from orchestrator

**Files:** `src/orchestrator/orchestrator.ts`, `src/web/sse.ts`

### 1d. Wire Existing Tools Into Agents

- Give `readIssueTool` and `createPRTool` to the coder agent
- Give `setupWorkspaceTool` to the pr-workflow agent

**Files:** `src/agents/coder.ts`, `src/agents/skills/pr-workflow.ts`

---

## Phase 2: Full Observability

### 2a. Expand Metrics Schema

New migration adding columns to the `metrics` table:
- `cost_usd REAL` — estimated dollar cost
- `status TEXT` — "completed" or "failed"
- `handoff_count INTEGER` — number of agent handoffs during the run
- `agent_name TEXT` — entry-point agent name

Update `MetricRecord` interface to include these fields.

**Files:** `src/db/migrations.ts`, `src/db/metrics.ts`, `src/db/schema.ts`

### 2b. Populate `token_usage` on Runs

After the stream completes in `executeRun()` and `executeReviewRun()`, persist `{ inputTokens, outputTokens }` JSON to the `token_usage` column via a new `RunsRepo.updateTokenUsage(runId, usage)` method.

**Files:** `src/db/runs.ts`, `src/orchestrator/orchestrator.ts`

### 2c. Track Handoff Counts

Add a `handoffCount` counter in `executeRun()` and `executeReviewRun()` (increment on `chunk.type === "handoff"`). Pass to `metricsRepo.record()`.

**Files:** `src/orchestrator/orchestrator.ts`

### 2d. Cost Estimation

New file `src/util/cost.ts` — lookup function `estimateCost(provider, model, tokensIn, tokensOut): number` with known per-token pricing for common models. Returns 0 for unknown models. Called before `metricsRepo.record()`.

**Files:** `src/util/cost.ts` (new), `src/orchestrator/orchestrator.ts`

### 2e. Dashboard Metrics Widgets

Expand `MetricsRepo.totals()` to return cost, success rate, average duration. Add `MetricsRepo.recentRuns()` for per-run breakdown. Update dashboard route.

**Files:** `src/db/metrics.ts`, `src/web/routes/dashboard.tsx`

---

## Phase 3: Automation — PR Monitor & CI Fixing

### 3a. Config Schema

```typescript
const ciFixingSchema = z.object({
  enabled: z.boolean().default(false),
  pollInterval: z.number().min(5000).default(60000),
  maxAttempts: z.number().min(1).default(2),
});
```

Default disabled — user opts in explicitly.

**Files:** `src/config/schema.ts`

### 3b. Wire PR Monitor

In `Orchestrator.start()`, when `ciFixing.enabled`, call `this.prMonitor.start()` with the configured poll interval.

**Files:** `src/orchestrator/orchestrator.ts`

### 3c. CI Fix Dispatch

New `tickCIFixes()` method on orchestrator:
- Called on PR Monitor's interval
- For each CI failure from `prMonitor.check()`, dispatch a coder agent with the failure prompt
- Run key pattern: `ci-fix:{prKey}` to avoid duplicate dispatches
- `Dispatcher.buildPRFixPrompt()` already exists
- On success, agent pushes fix commit, CI re-runs naturally
- Track attempts per PR, stop after `maxAttempts`

**Files:** `src/orchestrator/orchestrator.ts`

### 3d. Metrics

CI fix runs use the standard metrics pipeline from Phase 2 — no special handling needed.

---

## Phase 4: GitHub Projects Integration

### 4a. Projects API Client

New file `src/github/projects.ts` wrapping GitHub GraphQL API for Projects V2:
- `findProjectItems(projectId, owner, repo)` — fetch items from a project board
- `getItemStatus(itemId)` — read current status field
- `updateItemStatus(projectId, itemId, statusFieldId, statusOptionId)` — set status
- `addItemToProject(projectId, issueNodeId)` — add an issue to the project

Uses `gh api graphql` via `execFileSync` to avoid adding a GraphQL dependency, consistent with existing `gh` CLI patterns.

**Files:** `src/github/projects.ts` (new)

### 4b. Status Sync (Outbound)

Hook into orchestrator lifecycle events:
- Issue dispatched → status = `inProgress`
- PR created (detected after successful run) → status = `inReview`
- Run completed + PR merged → status = `done`
- Run failed → leave at `inProgress` (will retry)

One-time status field/option ID lookup on startup (cached). Only active when `config.project.id` is set.

**Files:** `src/orchestrator/orchestrator.ts`, `src/github/projects.ts`

### 4c. Board as Source (Inbound)

In `tick()`, when `config.project.id` is set:
- Query project board for items with status matching `config.project.statuses.todo`
- Convert project items to the existing `Issue` interface
- Merge with label-based polling (deduplicate by issue key)

Issues can enter the system via label OR project board placement.

**Files:** `src/orchestrator/orchestrator.ts`, `src/github/projects.ts`

---

## Phase 5: Specialist Agent Tools

### 5a. TDD Agent — Testing Tools

New file `src/tools/testing.ts`:
- `run_tests` — executes repo's test command (detected from package.json/Makefile), returns stdout/stderr and exit code
- `run_tests_filtered` — runs a specific test file or name pattern

**Files:** `src/tools/testing.ts` (new), `src/agents/skills/tdd.ts`

### 5b. Debugger Agent — Debugging Tools

New file `src/tools/debugging.ts`:
- `read_logs` — reads recent log output from a file path
- `inspect_error` — takes a stack trace, extracts file paths and line numbers, reads relevant source context around each frame

**Files:** `src/tools/debugging.ts` (new), `src/agents/skills/debugger.ts`

### 5c. Reviewer Agent

Give `readIssueTool` to the in-graph reviewer agent so it can read original issue requirements when reviewing code.

**Files:** `src/agents/skills/reviewer.ts`

### 5d. PR-Workflow Agent — CI Tools

New file `src/tools/ci.ts`:
- `check_ci_status` — queries GitHub check runs for a PR via `gh` CLI, returns pass/fail/pending per check

Also give it `createPRTool` (already exists).

**Files:** `src/tools/ci.ts` (new), `src/agents/skills/pr-workflow.ts`

### 5e. Agent Registration

Update each agent definition to include tools in their `tools` array. The agent graph structure doesn't change — only tool sets.

---

## New Files Summary

| File | Phase | Purpose |
|------|-------|---------|
| `src/util/cost.ts` | 2 | Token cost estimation |
| `src/github/projects.ts` | 4 | GitHub Projects V2 GraphQL client |
| `src/tools/testing.ts` | 5 | TDD agent tools |
| `src/tools/debugging.ts` | 5 | Debugger agent tools |
| `src/tools/ci.ts` | 5 | CI status tools for PR-workflow agent |

## Migration Summary

| Migration | Phase | Changes |
|-----------|-------|---------|
| Migration N+1 | 2 | Add `cost_usd`, `status`, `handoff_count`, `agent_name` to `metrics` table |
