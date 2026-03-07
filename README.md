# OneAgent

AI agent orchestrator for GitHub issues. Polls configured repos for labeled issues, dispatches coding agents via [one-agent-sdk](https://github.com/odysa/one-agent-sdk), and provides a real-time dashboard.

## Quick Start

```bash
# Install
npm install

# Create config
npx oneagent init

# Edit oneagent.yaml with your repos
# Set GITHUB_TOKEN env var

# Run
npx oneagent
```

## CLI

```
oneagent [options]        Start the orchestrator
  -c, --config <path>     Config file (default: oneagent.yaml)
  -p, --port <number>     Dashboard port override
  --dry-run               List eligible issues without dispatching
  --debug                 Enable debug logging
  --log <path>            Log to file

oneagent init             Create default config file
oneagent setup            Create GitHub labels on configured repos
```

## Config

See `oneagent.example.yaml` for all options. Key settings:

| Section | Key | Default | Description |
|---------|-----|---------|-------------|
| `github.repos` | — | required | Repos to monitor |
| `agent.provider` | — | `claude-code` | Agent backend (`claude-code`, `codex`, `kimi-cli`) |
| `agent.stallTimeout` | — | `300000` | Kill stalled agents after ms |
| `agent.maxRetries` | — | `3` | Retry failed runs |
| `concurrency.max` | — | `3` | Max parallel agents |
| `poll.interval` | — | `30000` | Poll interval ms |
| `web.port` | — | `3000` | Dashboard port |
| `poll.reconcileInterval` | — | `15000` | Interval for stale run checks (ms) |
| `prReview.enabled` | — | `true` | Enable PR review feedback iteration |
| `prReview.pollInterval` | — | `60000` | Poll interval for review comments (ms) |
| `prReview.provider` | — | `claude-code` | Provider for the review agent |
| `prReview.model` | — | — | Model for the review agent (optional) |
| `prReview.autoMerge` | — | `false` | Auto-merge PRs after review approval |
| `prReview.maxReviewCycles` | — | `2` | Max review-fix cycles before escalation |
| `prReview.requireChecks` | — | `true` | Require CI checks to pass before merge |
| `labels.eligible` | — | `oneagent` | Label marking eligible issues |
| `labels.inProgress` | — | `oneagent-working` | Label for in-progress issues |
| `labels.failed` | — | `oneagent-failed` | Label for failed issues |
| `labels.needsReview` | — | `oneagent-needs-review` | Label for PRs awaiting review |
| `labels.needsHuman` | — | `oneagent-needs-human` | Label for PRs needing human review |

## Custom Skills / Repo Context

OneAgent supports per-repo customization via a `.oneagent/` directory in the repository root:

- **`.oneagent/instructions.md`** — repo-specific instructions loaded by the agent at the start of each run
- **`.oneagent/skills/*.md`** — custom skills with frontmatter (`name`, `description`) that agents can invoke during a run

## Architecture

```
GitHub Issues (poll) → Orchestrator → one-agent-sdk run()
                          ↕                    ↕
                      SQLite DB          Agent Graph
                          ↕              (coder → tdd, debugger,
                      Hono Dashboard      reviewer, pr-workflow,
                      (SSE streaming)     planner, pr-reviewer)
```

**Poll-Dispatch-Reconcile loop:**
1. **Poll** — fetch labeled issues from configured repos
2. **Dispatch** — start agent runs for new issues (respecting concurrency)
3. **Reconcile** — check for stale runs, abort if needed

**Multi-agent handoffs:** The coder agent can hand off to specialist agents (TDD, debugger, reviewer, PR workflow, planner) which hand back when done.

## Orchestrator Features

- **Dependency detection** — issues with "Depends on #N" / "Blocked by #N" / "Requires #N" in the body are held until the referenced issue is closed
- **Skip resolved issues** — issues with a merged PR referencing them (Closes/Fixes/Resolves #N) are skipped, and a comment is posted suggesting closure
- **PR review iteration** — polls open PRs for review comments and dispatches agents to address feedback (configurable via `prReview.enabled`)
- **PR review agent** — after a coder run creates a PR, a dedicated review agent (configurable model/provider) independently reviews it, submitting GitHub PR reviews. Supports auto-merge gated by CI checks, review-fix cycles with configurable limits, and human escalation
- **Auto-rebase** — after a run completes, conflicting open PRs are automatically rebased onto main
- **Label cleanup** — `oneagent-working` label removed on completion; eligible label removed on success

## Dashboard

Visit `http://localhost:3000` when running. Pages:

- **Dashboard** — active agents, metrics, force refresh
- **Sprint Board** — kanban view (todo/in-progress/review/done)
- **Planning** — interactive planning sessions (see below)
- **Settings** — current config display

Real-time updates via Server-Sent Events.

### Interactive Planning

The `/planning/` page provides a conversational planning interface powered by the planner agent. The workflow follows a structured conversation:

1. **Understand** — the planner asks focused questions one at a time to understand requirements
2. **Propose** — suggests 2-3 approaches with tradeoffs for the user to choose from
3. **Plan** — builds a detailed implementation plan with ordered tasks and dependencies
4. **Refine** — iterates on the plan based on user feedback
5. **Publish** — creates GitHub issues for each task with dependency annotations (`Depends on #N`)

Once published, the orchestrator automatically picks up the issues and processes them in dependency order, enabling end-to-end planning-to-execution workflows.

## API Endpoints

OneAgent exposes a JSON API alongside the dashboard:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/status` | Current orchestrator state |
| `GET` | `/api/v1/runs/:id` | Single run details |
| `GET` | `/api/v1/metrics` | Duration stats, token usage, run counts |
| `GET` | `/health` | Health check with uptime and version |
| `POST` | `/api/v1/refresh` | Force a poll tick |
| `GET` | `/api/v1/events` | SSE stream |

## Development

```bash
npm run build     # Compile TypeScript
npm run dev       # Watch mode
npm test          # Run tests (vitest)
```

### Database Migrations

SQLite migrations use a `schema_version` table. New migrations go in the `MIGRATIONS` array in `src/db/migrations.ts`. Each migration has a version number, description, and idempotent `up()` function. Migrations run automatically on startup.

## Labels

OneAgent uses five labels (configurable):

- `oneagent` — marks issues eligible for agent work
- `oneagent-working` — applied while an agent is running
- `oneagent-failed` — applied when retries are exhausted
- `oneagent-needs-review` — PR awaiting review agent (add manually to trigger review)
- `oneagent-needs-human` — review cycles exhausted, human intervention needed
