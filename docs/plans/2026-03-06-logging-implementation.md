# Logging Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add structured logging with child loggers throughout the OneAgent codebase for operational visibility and debugging.

**Architecture:** Create a `createLogger()` factory in `src/logger.ts`, thread child loggers via dependency injection into all key modules, add an HTTP request logging middleware, and add `pino-pretty` for dev.

**Tech Stack:** pino, pino-pretty (dev), Hono middleware, TypeScript

---

### Task 1: Add pino-pretty and create logger factory

**Files:**
- Create: `src/logger.ts`
- Modify: `package.json` (via npm install)

**Step 1: Install pino-pretty**

Run: `npm install -D pino-pretty`

**Step 2: Create the logger factory**

Create `src/logger.ts`:

```typescript
import pino, { type Logger } from "pino";

export type { Logger } from "pino";

export interface LoggerOptions {
  level: string;
  logFile?: string;
}

export function createLogger(opts: LoggerOptions): Logger {
  const isDev = process.env.NODE_ENV !== "production";

  if (opts.logFile) {
    return pino({
      level: opts.level,
      transport: { target: "pino/file", options: { destination: opts.logFile } },
    });
  }

  if (isDev) {
    return pino({
      level: opts.level,
      transport: { target: "pino-pretty" },
    });
  }

  return pino({ level: opts.level });
}
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/logger.ts package.json package-lock.json
git commit -m "feat: add logger factory with pino-pretty support"
```

---

### Task 2: Wire logger factory into index.ts

**Files:**
- Modify: `src/index.ts:1-36`

**Step 1: Replace inline pino with createLogger**

In `src/index.ts`, replace the `pino` import (line 21) with:

```typescript
import { createLogger } from "./logger.js";
```

Replace lines 33-36 (the inline `pino(...)` call) with:

```typescript
    const logger = createLogger({
      level: opts.debug ? "debug" : "info",
      logFile: opts.log,
    });
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "refactor: use createLogger factory in index.ts"
```

---

### Task 3: Add logger to GitHubClient

**Files:**
- Modify: `src/github/client.ts`
- Modify: `src/index.ts:59`

**Step 1: Add logger to GitHubClient constructor**

In `src/github/client.ts`, add the import and modify the class:

```typescript
import { Octokit } from "octokit";
import type { Logger } from "pino";
import type { Issue, PullRequest, CheckRun } from "./types.js";

export class GitHubClient {
  private octokit: Octokit;
  private logger: Logger;

  constructor(token: string, logger: Logger) {
    this.octokit = new Octokit({ auth: token });
    this.logger = logger.child({ module: "github" });
  }
```

**Step 2: Add logging to API methods**

In `fetchIssues`, after the `await` call (after line 23):

```typescript
    this.logger.debug({ owner, repo, label, count: data.length }, "fetched issues");
```

In `addLabel`, after the `await` call (after line 40):

```typescript
    this.logger.debug({ owner, repo, number, label }, "added label");
```

In `removeLabel`, wrap the existing try/catch. Replace lines 44-47:

```typescript
  async removeLabel(owner: string, repo: string, number: number, label: string): Promise<void> {
    try {
      await this.octokit.rest.issues.removeLabel({ owner, repo, issue_number: number, name: label });
      this.logger.debug({ owner, repo, number, label }, "removed label");
    } catch {
      this.logger.debug({ owner, repo, number, label }, "label not present, skipping removal");
    }
  }
```

In `fetchPRsWithLabel`, after the `await` call (after line 50):

```typescript
    this.logger.debug({ owner, repo, label, count: data.length }, "fetched PRs");
```

In `fetchCheckRuns`, after the `await` call (after line 65):

```typescript
    this.logger.debug({ owner, repo, ref, count: data.check_runs.length }, "fetched check runs");
```

**Step 3: Update index.ts to pass logger**

In `src/index.ts`, change line 59 from:

```typescript
    const github = new GitHubClient(token);
```

to:

```typescript
    const github = new GitHubClient(token, logger);
```

Also update the `setup` command (line 163) — it creates a GitHubClient without a logger. Since setup is a simple CLI command, create a silent logger:

```typescript
    const github = new GitHubClient(token, pino({ level: "silent" }));
```

Add `import pino from "pino";` back to `src/index.ts` for this usage (or import from logger.ts — simplest is to keep `pino` import for the setup command).

Actually, simpler approach: make logger optional in GitHubClient with a default silent logger:

```typescript
  constructor(token: string, logger?: Logger) {
    this.octokit = new Octokit({ auth: token });
    this.logger = (logger ?? pino({ level: "silent" })).child({ module: "github" });
  }
```

Add `import pino from "pino";` to `src/github/client.ts`.

This way `src/index.ts` line 59 becomes `new GitHubClient(token, logger)` and the setup command stays as `new GitHubClient(token)`.

**Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/github/client.ts src/index.ts
git commit -m "feat: add structured logging to GitHubClient"
```

---

### Task 4: Add logger to WorkspaceManager

**Files:**
- Modify: `src/workspace/manager.ts`
- Modify: `src/index.ts:60`

**Step 1: Add logger to WorkspaceManager**

Replace `src/workspace/manager.ts`:

```typescript
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";

export class WorkspaceManager {
  private logger: Logger;

  constructor(private baseDir: string, logger?: Logger) {
    mkdirSync(baseDir, { recursive: true });
    const pino = await import("pino"); // avoid — use different approach
  }
```

Actually, same pattern as GitHubClient — make logger optional with silent fallback:

```typescript
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import pino, { type Logger } from "pino";

export class WorkspaceManager {
  private logger: Logger;

  constructor(private baseDir: string, logger?: Logger) {
    this.logger = (logger ?? pino({ level: "silent" })).child({ module: "workspace" });
    mkdirSync(baseDir, { recursive: true });
  }

  ensure(issueKey: string): string {
    const dirName = issueKey.replace(/[/#]/g, "-");
    const dir = join(this.baseDir, dirName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      this.logger.info({ issueKey, dir }, "workspace created");
    }
    return dir;
  }

  path(issueKey: string): string {
    return join(this.baseDir, issueKey.replace(/[/#]/g, "-"));
  }
}
```

**Step 2: Update index.ts**

Change line 60 from:

```typescript
    const workspace = new WorkspaceManager(config.workspace.baseDir);
```

to:

```typescript
    const workspace = new WorkspaceManager(config.workspace.baseDir, logger);
```

**Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/workspace/manager.ts src/index.ts
git commit -m "feat: add structured logging to WorkspaceManager"
```

---

### Task 5: Add logger to ConfigWatcher

**Files:**
- Modify: `src/config/watcher.ts`

**Step 1: Add logging to ConfigWatcher**

Replace `src/config/watcher.ts`:

```typescript
import { loadConfigFromString } from "./loader.js";
import type { Config } from "./schema.js";
import pino, { type Logger } from "pino";

export class ConfigWatcher {
  private logger: Logger;

  constructor(private onChange: (config: Config) => void, logger?: Logger) {
    this.logger = (logger ?? pino({ level: "silent" })).child({ module: "config" });
  }

  handleFileChange(yamlContent: string): void {
    try {
      const config = loadConfigFromString(yamlContent);
      this.onChange(config);
      this.logger.info("config reloaded");
    } catch (err) {
      this.logger.error({ err }, "config validation failed, keeping previous config");
    }
  }
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/config/watcher.ts
git commit -m "feat: add structured logging to ConfigWatcher"
```

---

### Task 6: Add logging to Orchestrator

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`

The orchestrator already has some logging via `this.deps.logger?.`. The changes here are:

1. Make logger non-optional and create a child logger
2. Add logging to tick() and dispatch()
3. Clean up existing optional chaining on logger

**Step 1: Update constructor and deps interface**

In `src/orchestrator/orchestrator.ts`, change the `OrchestratorDeps` interface — make `logger` required:

```typescript
export interface OrchestratorDeps {
  config: Config;
  github: GitHubClient;
  runsRepo?: RunsRepo;
  eventsRepo?: RunEventsRepo;
  metricsRepo?: MetricsRepo;
  workspace?: WorkspaceManager;
  logger: Logger;
}
```

Add a `logger` field to the class and set it in constructor:

```typescript
  private logger: Logger;

  constructor(
    private config: Config,
    private github: GitHubClient,
    private deps: OrchestratorDeps,
  ) {
    this.logger = deps.logger.child({ module: "orchestrator" });
    this.retryQueue = new RetryQueue(
      config.agent.retryBaseDelay,
      config.agent.maxRetries,
    );
    const graph = buildAgentGraph();
    this.agentMap = Object.fromEntries(graph);
  }
```

Note: also change `deps` from `Partial<OrchestratorDeps>` to `OrchestratorDeps`.

**Step 2: Add logging to start/stop**

```typescript
  start(): void {
    this.logger.info({
      pollInterval: this.config.poll.interval,
      reconcileInterval: this.config.poll.reconcileInterval,
    }, "orchestrator started");
    this.pollTimer = setInterval(() => this.tick(), this.config.poll.interval);
    this.reconcileTimer = setInterval(() => this.reconcile(), this.config.poll.reconcileInterval);
    this.tick();
  }

  stop(): void {
    const activeCount = this.state.activeCount();
    this.logger.info({ activeCount }, "orchestrator stopping");
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    for (const [, entry] of this.state.running()) {
      entry.abortController?.abort();
    }
  }
```

**Step 3: Add logging to tick()**

After fetching all issues (after line 73), add:

```typescript
    this.logger.info({ issueCount: allIssues.length, retryCount: retryKeys.length }, "poll tick");
```

When concurrency limit is hit (at the `break` on line 79), add before the break:

```typescript
      if (this.state.activeCount() >= this.config.concurrency.max) {
        this.logger.debug({ max: this.config.concurrency.max }, "concurrency limit reached");
        break;
      }
```

(Same for the second break on line 87.)

**Step 4: Add logging to dispatch()**

After creating the entry (after line 111), add:

```typescript
    const runLogger = this.logger.child({ runId, issueKey: issue.key, repo: `${issue.owner}/${issue.repo}` });
    runLogger.info("dispatching agent");
```

**Step 5: Replace all `this.deps.logger?.` with `this.logger.`**

Throughout `executeRun` and `reconcile`, replace:
- `this.deps.logger?.error(` → `this.logger.error(`
- `this.deps.logger?.warn(` → `this.logger.warn(`
- `this.deps.logger?.info(` → `this.logger.info(`

**Step 6: Add completion/failure logging in executeRun**

After line 184 (mark completed), add:

```typescript
      this.logger.info({ runId, issueKey: issue.key, durationMs: Date.now() - entry.startedAt.getTime() }, "agent run completed");
```

Note: `entry` is used after `this.state.remove(issue.key)` which removes it from state, so capture `startedAt` before removing. Move the `const startedAt = entry.startedAt;` before `this.state.remove()`, then use it in the log.

**Step 7: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add src/orchestrator/orchestrator.ts
git commit -m "feat: add structured logging to Orchestrator"
```

---

### Task 7: Create HTTP request logging middleware

**Files:**
- Create: `src/middleware/request-logger.ts`
- Modify: `src/web/app.ts`
- Modify: `src/index.ts`

**Step 1: Create the middleware**

Create `src/middleware/request-logger.ts`:

```typescript
import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";

export function requestLogger(logger: Logger): MiddlewareHandler {
  const httpLogger = logger.child({ module: "http" });
  return async (c, next) => {
    const start = Date.now();
    await next();
    const durationMs = Date.now() - start;
    httpLogger.info({
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
    }, "request");
  };
}
```

**Step 2: Wire it into createApp**

In `src/web/app.ts`, update the function to accept a logger and apply middleware:

Add import:

```typescript
import type { Logger } from "pino";
import { requestLogger } from "../middleware/request-logger.js";
```

Update `FullAppContext` to include logger:

```typescript
export interface FullAppContext {
  app: AppContext;
  sprint?: SprintContext;
  issues?: IssuesContext;
  planning?: PlanningContext;
  getConfig?: () => Config;
  logger?: Logger;
}
```

In `createApp`, after `const app = new Hono();`, add:

```typescript
  if (isFullCtx && ctx.logger) {
    app.use("*", requestLogger(ctx.logger));
  }
```

**Step 3: Pass logger in index.ts**

In `src/index.ts`, in the `FullAppContext` object passed to `createApp` (around line 88), add `logger`:

```typescript
      const app = createApp({
        app: appCtx,
        // ... existing fields ...
        getConfig: () => config,
        logger,
      });
```

**Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/middleware/request-logger.ts src/web/app.ts src/index.ts
git commit -m "feat: add HTTP request logging middleware"
```

---

### Task 8: Final verification

**Step 1: Full compile check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run tests**

Run: `npm test -- --run`
Expected: All tests pass (logging changes should not break existing tests since logger is optional in most places)

**Step 3: If tests fail, fix any issues**

Common fixes:
- Tests that construct classes without a logger — either pass a silent pino logger or rely on the optional fallback
- Type errors from making `deps.logger` required in Orchestrator — update test fixtures

**Step 4: Commit any test fixes**

```bash
git add -A
git commit -m "fix: update tests for required logger parameter"
```
