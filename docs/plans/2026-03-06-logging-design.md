# Logging Improvements Design

## Problem

OneAgent has 8 log statements across 47 source files. Critical modules (orchestrator, GitHub client, agent execution, workspace management) produce no logs, making it difficult to understand system behavior or troubleshoot issues.

## Goals

- Operational visibility at `info` level: what the system is doing, what succeeded, what failed
- Debug-level detail available on demand for troubleshooting
- Structured context fields (runId, repo, issueNumber) for correlating logs to specific runs
- Pretty-printed logs in development, JSON in production

## Approach: Logger Factory with Child Loggers

### 1. Logger Module (`src/logger.ts`)

New module exporting `createLogger(opts)`:

- Accepts `{ level: string; logFile?: string }`
- Configures `pino-pretty` transport when `NODE_ENV !== "production"` and no log file specified
- Replaces inline `pino(...)` call in `src/index.ts`

Add `pino-pretty` as a dev dependency.

### 2. Child Logger Pattern

Each module receives a logger via constructor and creates a child:

```typescript
this.logger = logger.child({ module: "orchestrator" });
```

For run-scoped work, create a further child with correlation context:

```typescript
const runLogger = this.logger.child({ runId, repo: issue.repo, issue: issue.number });
```

Every log line in that flow automatically includes the context fields.

**Modules receiving a logger via constructor:**
- Orchestrator (already has optional logger — make required)
- Dispatcher
- GitHubClient
- WorkspaceManager
- ConfigWatcher
- Web app (via Hono middleware)

**Modules that do NOT need a logger** (pure data/schema):
- `db/schema.ts`, `config/schema.ts`, agent definitions

### 3. Logging Coverage

**Orchestrator** (info + debug):
- Poll cycle start/end with issue count
- Issue dispatch (with runId, repo, issue number)
- Run completion/failure
- Reconcile cycle results
- Concurrency limit reached (debug)

**Dispatcher** (info + debug):
- Agent execution started/completed/failed with duration
- Agent handoffs (debug)

**GitHubClient** (debug + warn):
- API calls: method, endpoint, response status (debug)
- Rate limit warnings (warn)

**WorkspaceManager** (info + debug):
- Workspace created/cleaned up
- Hook execution start/result, failures (warn)

**ConfigWatcher** (info + error):
- Config file changed, reloaded
- Config validation errors (error)

**Database** — No logging. Thin data layer; errors surface in callers.

### 4. HTTP Request Logging Middleware

New Hono middleware (`src/middleware/request-logger.ts`):
- Captures start time on request
- Logs on response: `{ method, path, status, durationMs }` at info level
- SSE connection opened/closed at debug level
- Receives logger via closure
