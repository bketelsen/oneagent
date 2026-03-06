# OneAgent: Gopilot Rewrite Using one-agent-sdk

**Date:** 2026-03-06
**Status:** Approved

## Summary

Full rewrite of [gopilot](https://github.com/bketelsen/gopilot) in TypeScript using [one-agent-sdk](https://odysa.github.io/one-agent-sdk/). Gopilot is a Go-based AI agent orchestrator that polls GitHub issues, dispatches coding agents, monitors their lifecycle, and provides a web dashboard. The rewrite preserves the proven poll-dispatch-reconcile architecture while leveraging one-agent-sdk for provider-agnostic agent execution, multi-agent handoffs, and middleware pipelines.

## Key Decisions

| Aspect | Decision |
|---|---|
| Language | TypeScript |
| Agent SDK | one-agent-sdk (all providers + extensibility) |
| Web | Hono + JSX + SSE |
| Persistence | SQLite (better-sqlite3) + in-memory Map for active state |
| GitHub | Source of truth for issues/PRs, octokit client |
| Planning | First-class planner agent with SDK sessions, WebSocket UI |
| Skills | Specialist agents with handoff pattern |
| Architecture | Poll-dispatch-reconcile (same as gopilot) |
| CLI | commander |

## Project Structure

```
oneagent/
├── src/
│   ├── index.ts                 # CLI entry point (commander)
│   ├── config/
│   │   ├── schema.ts            # Zod config schema
│   │   ├── loader.ts            # YAML loader + chokidar watcher
│   │   └── defaults.ts
│   ├── orchestrator/
│   │   ├── orchestrator.ts      # Poll-dispatch-reconcile loop
│   │   ├── state.ts             # In-memory run state (Map-based)
│   │   ├── dispatcher.ts        # Claims issue, builds agent config, calls run()
│   │   ├── reconciler.ts        # Checks running agents for terminal conditions
│   │   ├── retry.ts             # Exponential backoff retry queue
│   │   └── pr-monitor.ts        # Polls PRs for CI failures, dispatches fix agents
│   ├── agents/
│   │   ├── coder.ts             # Main coding agent definition
│   │   ├── planner.ts           # Planning agent with multi-turn sessions
│   │   ├── skills/
│   │   │   ├── tdd.ts           # TDD specialist agent
│   │   │   ├── debugger.ts      # Debugging specialist agent
│   │   │   ├── reviewer.ts      # Code review specialist agent
│   │   │   └── pr-workflow.ts   # PR workflow specialist agent
│   │   ├── graph.ts             # Builds agent map with handoff relationships
│   │   └── prompts.ts           # Prompt templates
│   ├── tools/
│   │   ├── github.ts            # GitHub tools (defineTool)
│   │   ├── planning.ts          # Planning tools: create-plan, refine-plan
│   │   └── workspace.ts         # Workspace tools: create dir, run hooks
│   ├── github/
│   │   ├── client.ts            # GitHub REST + GraphQL client (octokit)
│   │   └── types.ts             # Issue, PR, CheckRun types
│   ├── db/
│   │   ├── schema.ts            # SQLite schema
│   │   ├── migrations.ts        # Schema migrations
│   │   ├── runs.ts              # Run history queries
│   │   ├── planning.ts          # Planning SessionStore implementation
│   │   └── metrics.ts           # Token usage storage
│   ├── web/
│   │   ├── app.ts               # Hono app setup
│   │   ├── routes/
│   │   │   ├── dashboard.tsx    # Dashboard page
│   │   │   ├── sprint.tsx       # Sprint board
│   │   │   ├── issues.tsx       # Issue detail + agent output log
│   │   │   ├── settings.tsx     # Config display
│   │   │   ├── planning.tsx     # Planning session UI
│   │   │   └── api.ts           # SSE endpoint + refresh trigger
│   │   ├── sse.ts               # SSE event hub
│   │   └── components/          # Shared JSX components
│   ├── workspace/
│   │   ├── manager.ts           # Per-issue directory management
│   │   └── hooks.ts             # Lifecycle hook runner
│   └── middleware/
│       ├── logging.ts           # Agent stream logging
│       ├── stall-detector.ts    # Kills stalled agents
│       └── event-bridge.ts      # Pipes StreamChunks to SSE + SQLite
├── package.json
├── tsconfig.json
└── oneagent.yaml                # Config file
```

## Architecture: Agent Graph

The core change from gopilot: subprocess management is replaced by one-agent-sdk's `run()` with a multi-agent graph. Each GitHub issue gets a `run()` call with an agent that can hand off to specialist skill agents.

```
                    ┌─────────────┐
                    │  Dispatcher  │  (TypeScript code, not an agent)
                    └──────┬──────┘
                           │ run(prompt, { agent: "coder", agents: agentMap })
                           ▼
                    ┌─────────────┐
               ┌───►│   Coder     │◄───┐
               │    │  (primary)  │    │
               │    └──┬──┬──┬──┬─┘    │
               │       │  │  │  │      │
          handoff      │  │  │  │   handoff back
               │       ▼  │  │  ▼      │
               │  ┌────┐  │  │  ┌──────┴──┐
               │  │TDD │  │  │  │Reviewer │
               │  └────┘  │  │  └─────────┘
               │       ▼  │  ▼
               │  ┌──────┐│ ┌──────────┐
               │  │Debug ││ │PR Workflow│
               │  └──────┘│ └──────────┘
               │          ▼
               │   ┌──────────┐
               └───│ Planner  │
                   └──────────┘
```

**Agent roles:**

- **Coder** — Primary agent. Works on GitHub issues: reads issue, writes code, runs tests, commits, pushes. Declares handoffs to all skill agents.
- **TDD** — Enforces test-first workflow. Rigid: write failing test, implement, verify green, refactor. Hands back to Coder.
- **Debugger** — Systematic debugging: reproduce, hypothesize, verify, fix. Hands back to Coder.
- **Reviewer** — Reviews code before PR creation for quality, security, correctness. Hands back to Coder with feedback.
- **PR Workflow** — Handles PR creation, CI monitoring, fix-up commits. Used by Coder and the PR monitor.
- **Planner** — Interactive planning agent with tools (create-plan, refine-plan, estimate-complexity). Uses SDK sessions for multi-turn persistence. Separate entry point from the planning UI.

## Orchestrator Loop

Same poll-dispatch-reconcile pattern as gopilot:

1. **Poll** — Fetch open GitHub issues with eligible labels via octokit, filter by project status ("Todo"), check for blocking dependencies, skip issues with open PRs.
2. **Dispatch** — Claim issue (label it in-progress), set up workspace, build agent config, call `run()` with the agent graph + middleware stack.
3. **Reconcile** — On each tick, check if running agents' issues have become terminal (closed, PR opened, label removed). Call `abort()` on the AbortController to stop the agent.

**State:** In-memory `Map<issueKey, RunEntry>` for active runs. On completion, persisted to SQLite and removed from Map.

**Retry:** Exponential backoff (`baseDelay * 2^retryCount`) up to `maxRetries`. After exhaustion, issue gets labeled `oneagent-failed`.

**PR monitoring:** Separate interval polls labeled PRs for failed CI check runs, fetches failure logs, dispatches PR Workflow agent to push fixes.

**Stall detection:** Implemented as one-agent-sdk middleware. Tracks time since last StreamChunk — if threshold exceeded, aborts the run signal.

## Web Dashboard

Hono + JSX server-side rendered pages with SSE for live updates:

| Route | Purpose |
|---|---|
| `/` | Dashboard: running agents, retry queue, metrics |
| `/sprint` | Kanban board (Todo/In Progress/In Review/Done) |
| `/issues/:owner/:repo/:id` | Issue detail with agent output log |
| `/settings` | Config display, provider availability |
| `/planning` | List/create planning sessions |
| `/planning/:id` | Planning chat UI (WebSocket) |
| `/api/v1/events` | SSE stream |
| `/api/v1/refresh` | Force a poll tick |

**SSE events:** `agent:started`, `agent:output`, `agent:tool_call`, `agent:handoff`, `agent:completed`, `agent:error`, `retry:queued`, `planning:message`.

**Planning:** WebSocket-based multi-turn chat. Server holds SDK session backed by SQLite SessionStore. Each user message calls `session.chat()`, streaming response chunks back over WebSocket.

## Database Schema

SQLite via better-sqlite3:

```sql
CREATE TABLE runs (
  id          TEXT PRIMARY KEY,
  issue_key   TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT,
  status      TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  retry_count INTEGER DEFAULT 0,
  error       TEXT,
  token_usage TEXT
);

CREATE TABLE run_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs(id),
  type    TEXT NOT NULL,
  payload TEXT NOT NULL,
  ts      TEXT NOT NULL
);

CREATE TABLE planning_sessions (
  id         TEXT PRIMARY KEY,
  issue_key  TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  history    TEXT NOT NULL
);

CREATE TABLE metrics (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id     TEXT REFERENCES runs(id),
  provider   TEXT NOT NULL,
  model      TEXT,
  tokens_in  INTEGER,
  tokens_out INTEGER,
  duration_ms INTEGER,
  ts         TEXT NOT NULL
);
```

**Persistence strategy:** In-memory Map for active runs (fast), SQLite for history/planning/metrics (durable), GitHub for issue/PR state (source of truth).

## Configuration

YAML config file (`oneagent.yaml`) validated with Zod. Supports env var interpolation, per-repo provider overrides, workspace hooks, and hot reload via chokidar.

## Middleware Pipeline

Applied to every `run()` call:

1. `logging()` — Log all StreamChunks via pino
2. `usageTracker()` — Track token usage per run
3. `stallDetector({ timeout })` — Abort runs with no output past threshold
4. `eventBridge(sseHub, db)` — Pipe chunks to SSE hub + SQLite

## Error Handling

| Failure | Response |
|---|---|
| Agent stream error | Log, mark run failed, queue for retry |
| Stall timeout | Abort signal, mark failed, queue for retry |
| Provider subprocess crash | SDK surfaces as error chunk, same retry path |
| GitHub API rate limit | Exponential backoff on poll interval |
| GitHub API auth failure | Log, halt orchestrator, surface on dashboard |
| SQLite write failure | Log, continue (in-memory state is primary) |
| Config parse failure on reload | Log warning, keep previous config |
| Max retries exhausted | Label issue `oneagent-failed` |

**Graceful shutdown:** On SIGTERM/SIGINT, abort all active AbortControllers, wait up to 10s for streams to close, flush SQLite, exit.

## Dependencies

| Package | Purpose |
|---|---|
| `one-agent-sdk` | Agent execution, tools, handoffs, sessions, middleware |
| `hono` | Web framework + JSX + SSE |
| `better-sqlite3` | SQLite persistence |
| `octokit` | GitHub REST + GraphQL |
| `commander` | CLI argument parsing |
| `chokidar` | Config file watching |
| `zod` | Config + schema validation |
| `pino` | Structured logging |
| `ulid` | Run ID generation |

## Mapping from Gopilot

| Gopilot (Go) | OneAgent (TypeScript) |
|---|---|
| `internal/orchestrator/` | `src/orchestrator/` — same pattern |
| `internal/agent/ClaudeRunner` | `run()` with `provider: "claude-code"` |
| `internal/agent/CopilotRunner` | `run()` with `provider: "codex"` |
| `internal/github/Client` | octokit wrapper in `src/github/client.ts` |
| `internal/web/` (chi + templ + SSE) | Hono + JSX + SSE |
| `internal/planning/` (WebSocket) | Planner agent + SDK sessions + WebSocket |
| `internal/skills/` (SKILL.md) | Specialist agents in `src/agents/skills/` |
| `internal/workspace/` | `src/workspace/` |
| `internal/domain/` types | `src/github/types.ts` + Zod schemas |
| In-memory state + sync.RWMutex | Map-based state (single-threaded) |
| `internal/metrics/` | `src/db/metrics.ts` (SQLite) |
