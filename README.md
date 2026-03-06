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

## Architecture

```
GitHub Issues (poll) → Orchestrator → one-agent-sdk run()
                          ↕                    ↕
                      SQLite DB          Agent Graph
                          ↕              (coder → tdd, debugger,
                      Hono Dashboard      reviewer, pr-workflow,
                      (SSE streaming)     planner)
```

**Poll-Dispatch-Reconcile loop:**
1. **Poll** — fetch labeled issues from configured repos
2. **Dispatch** — start agent runs for new issues (respecting concurrency)
3. **Reconcile** — check for stale runs, abort if needed

**Multi-agent handoffs:** The coder agent can hand off to specialist agents (TDD, debugger, reviewer, PR workflow, planner) which hand back when done.

## Dashboard

Visit `http://localhost:3000` when running. Pages:

- **Dashboard** — active agents, metrics, force refresh
- **Sprint Board** — kanban view (todo/in-progress/review/done)
- **Planning** — interactive planning sessions
- **Settings** — current config display

Real-time updates via Server-Sent Events.

## Development

```bash
npm run build     # Compile TypeScript
npm run dev       # Watch mode
npm test          # Run tests (vitest)
```

## Labels

OneAgent uses three labels (configurable):

- `oneagent` — marks issues eligible for agent work
- `oneagent-working` — applied while an agent is running
- `oneagent-failed` — applied when retries are exhausted
