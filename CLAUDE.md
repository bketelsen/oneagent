# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Compile TypeScript (tsc)
npm run dev            # Watch mode (tsc --watch)
npm test               # Run all tests (vitest)
npx vitest run src/db/__tests__/runs.test.ts   # Run a single test file
npx vitest run -t "test name"                  # Run tests matching a name
npm start              # Run compiled app (node dist/index.js --debug)
```

## Architecture

OneAgent is an AI agent orchestrator that polls GitHub issues for a configurable label, dispatches coding agents via `one-agent-sdk`, and provides a Hono-based dashboard with SSE streaming.

**Core loop (Orchestrator):** Poll GitHub -> Dispatch agent runs -> Reconcile stale runs. The `Orchestrator` class in `src/orchestrator/orchestrator.ts` owns this cycle, using `RunState` for in-memory tracking and `RetryQueue` for exponential backoff retries.

**Agent graph:** Multi-agent system defined in `src/agents/graph.ts`. The `coder` agent is the entry point and can hand off to specialist agents (`tdd`, `debugger`, `reviewer`, `pr-workflow`, `planner`). The `pr-reviewer` agent operates independently (no handoffs) with its own model/provider. Agents are `AgentDef` objects with name, prompt, and handoff declarations, executed via `one-agent-sdk`'s `run()`. The `planner` agent uses a structured superpowers-style prompt (one question at a time, propose approaches, build detailed plans) with three tools: `create_plan`, `refine_plan`, `publish_plan`. Plans are persisted in SQLite and can be published as GitHub issues with dependency graphs. The `createPlannerAgent()` factory accepts tools for the web planning UI.

**Key modules:**

- `src/config/` — YAML config loading with Zod v4 validation (`configSchema`). Uses a `withDefault` preprocess helper because Zod v4 doesn't apply inner defaults when outer default is `{}`.
- `src/db/` — SQLite via `better-sqlite3` with WAL mode. Repos: `RunsRepo`, `RunEventsRepo`, `MetricsRepo`, `PlanningRepo`. Migrations in `migrations.ts`.
- `src/github/` — `GitHubClient` wraps Octokit for issue fetching, label management, PR checks.
- `src/web/` — Hono app with JSX routes (using `hono/jsx`). Dashboard, sprint board, planning, settings pages. SSE via `SSEHub`.
- `src/workspace/` — `WorkspaceManager` creates isolated working directories per issue with optional setup/teardown hooks.
- `src/tools/planning.ts` — Factory function `createPlanningTools()` returns `create_plan`, `refine_plan`, `publish_plan` tools that persist plans to PlanningRepo and publish as GitHub issues via `gh` CLI.
- `src/middleware/` — Stall detector (aborts stuck agents), event bridge, request logger.

**Entry point:** `src/index.ts` — CLI via Commander with `start`, `init`, `setup` subcommands. Loads `.env.local` then `.env` via dotenv.

## Tech Stack

- TypeScript (ES2022, Node16 modules, strict mode)
- Hono + `@hono/node-server` for HTTP, JSX via `hono/jsx` (tsconfig `jsxImportSource`)
- `one-agent-sdk` for agent execution
- `better-sqlite3` for persistence
- Zod v4 for config validation
- Pino for structured logging (`pino-pretty` in dev)
- Vitest for testing (no config file — uses defaults)

## Config

Config is loaded from `oneagent.yaml` (default path). Schema defined in `src/config/schema.ts`. GitHub token resolved from config or `GITHUB_TOKEN` env var. Currently configured to dogfood itself (`bketelsen/oneagent` with `dogfood` label).

## Orchestrator Features

- **Dependency detection:** Issues with "Depends on #N", "Blocked by #N", or "Requires #N" in the body are held until the referenced issue is closed.
- **Skip resolved issues:** Issues with a merged PR that references them (Closes/Fixes/Resolves #N) are skipped, and a comment is posted suggesting closure.
- **PR review iteration:** When enabled (`prReview.enabled`), polls open PRs for new review comments and dispatches agents to address feedback on the existing branch.
- **PR review agent:** After a coder run produces a PR, a dedicated `pr-reviewer` agent (with its own model/provider from `prReview` config) independently reviews it. Submits GitHub PR reviews (approve/request-changes). On request-changes, the coder addresses feedback, then the reviewer re-reviews. After `maxReviewCycles` (default 2), escalates with `oneagent-needs-human` label. Auto-merge is opt-in (`prReview.autoMerge`) and gated by CI checks. Manual trigger: add `oneagent-needs-review` label to any PR.
- **Auto-rebase:** After a run completes, checks other open PRs for merge conflicts and rebases them automatically using authenticated git URLs.
- **Label cleanup:** Removes `oneagent-working` label on both success and failure; removes eligible label on success.

## Database Migrations

SQLite migrations use a `schema_version` table. New migrations go in the `MIGRATIONS` array in `src/db/migrations.ts`. Each migration has a version number, description, and idempotent `up()` function. Migrations run automatically on startup.

## Writing Good Agent Issues

When creating GitHub issues for oneagent to work on:
- Be explicit about what NOT to change — prevents scope creep
- Include exact code snippets for integration tasks (before/after)
- Reference exact file paths and line numbers
- State prerequisites: "Depends on #N" for dependency detection
- One logical change per issue

## Documentation

**CRITICAL**: Always update CLAUDE.md with any important technical or implementation details.

**CRITICAL**: Always update README.md details of new features.
