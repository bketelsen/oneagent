# Dogfooding Design

## Goal

Point oneagent at its own repository so it can work on real issues against its own codebase, validating the orchestration pipeline end-to-end.

## Setup

- **Config**: Update `oneagent.yaml` to target `bketelsen/oneagent` with label `dogfood`
- **Operational model**: Run oneagent from a second clone of the repo so the running instance's code isn't modified under its feet. PRs are reviewed and merged manually.
- **Label**: Use `dogfood` label to clearly mark issues intended for the agent

## Config

```yaml
github:
  token: $(gh auth token)
  repos:
    - owner: bketelsen
      repo: oneagent
      labels: [dogfood]

agent:
  provider: claude-code
  stallTimeout: 300000
  maxRetries: 1

concurrency:
  max: 1

poll:
  interval: 30000

web:
  port: 3000
  enabled: true
```

## Issues

### Wave 1: Low-risk validation

These exercise the pipeline without risking core functionality.

1. **Add missing test coverage for config loader** — Verify and expand test coverage for `src/config/loader.ts`. Exercises TDD agent.
2. **Add JSDoc comments to AgentDef interface and graph.ts exports** — Safe documentation task. Pure coder work.
3. **Create a .oneagent/skills/ directory with a PR formatting skill** — Meta: the agent sets up its own repo context for future runs. Tests repo-context discovery.
4. **Add a health check endpoint to the web server** — Small feature exercising coder + TDD + pr-workflow chain.
5. **Fix: config schema should validate that poll.interval is at least 5000ms** — Small validation improvement. Exercises coder + TDD.

### Wave 2: Real features (after Wave 1 validates)

6. **Add run duration tracking to the metrics database** — Real feature touching db layer.
7. **Support multiple labels per repo in config (OR logic for issue matching)** — Improves orchestrator flexibility.
8. **Add a /runs/:id page to the web dashboard showing run events** — Frontend feature with Hono JSX.
9. **Add retry count and last error to the dashboard runs table** — Dashboard improvement pulling from existing data.
10. **Emit structured log events when agent hands off between specialists** — Observability improvement touching middleware.
