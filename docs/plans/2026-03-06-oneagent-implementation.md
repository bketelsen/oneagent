# OneAgent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite gopilot in TypeScript using one-agent-sdk with full feature parity.

**Architecture:** Poll-dispatch-reconcile orchestrator that uses one-agent-sdk's `run()` for provider-agnostic agent execution with multi-agent handoffs. Hono+JSX dashboard, SQLite persistence, GitHub as source of truth.

**Tech Stack:** TypeScript, one-agent-sdk, Hono, better-sqlite3, octokit, commander, zod, pino

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `.gitignore`

**Step 1: Initialize project**

```bash
npm init -y
```

**Step 2: Install core dependencies**

```bash
npm install one-agent-sdk hono @hono/node-server better-sqlite3 octokit commander zod pino yaml chokidar ulid
npm install -D typescript @types/node @types/better-sqlite3 vitest
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx",
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 4: Create minimal src/index.ts**

```typescript
#!/usr/bin/env node
console.log("oneagent");
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
*.db
```

**Step 6: Add scripts to package.json**

Add `"type": "module"` and scripts:
```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest",
    "start": "node dist/index.js"
  }
}
```

**Step 7: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold TypeScript project with dependencies"
```

---

### Task 2: Config Schema & Loader

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/defaults.ts`
- Create: `src/config/loader.ts`
- Create: `src/config/index.ts`
- Test: `src/config/__tests__/schema.test.ts`
- Test: `src/config/__tests__/loader.test.ts`

**Step 1: Write failing test for config schema validation**

```typescript
// src/config/__tests__/schema.test.ts
import { describe, it, expect } from "vitest";
import { configSchema } from "../schema.js";

describe("configSchema", () => {
  it("validates a minimal valid config", () => {
    const result = configSchema.safeParse({
      github: {
        repos: [{ owner: "test", repo: "repo", labels: ["oneagent"] }],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects config missing repos", () => {
    const result = configSchema.safeParse({ github: {} });
    expect(result.success).toBe(false);
  });

  it("applies defaults for optional fields", () => {
    const result = configSchema.parse({
      github: {
        repos: [{ owner: "test", repo: "repo", labels: ["oneagent"] }],
      },
    });
    expect(result.agent.provider).toBe("claude-code");
    expect(result.agent.stallTimeout).toBe(300000);
    expect(result.agent.maxRetries).toBe(3);
    expect(result.concurrency.max).toBe(3);
    expect(result.poll.interval).toBe(30000);
    expect(result.web.port).toBe(3000);
    expect(result.web.enabled).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: FAIL — module not found

**Step 3: Implement config schema**

```typescript
// src/config/schema.ts
import { z } from "zod";

const repoSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  labels: z.array(z.string()),
  provider: z.string().optional(),
  model: z.string().optional(),
});

const githubSchema = z.object({
  token: z.string().optional(),
  repos: z.array(repoSchema).min(1),
});

const agentSchema = z.object({
  provider: z.string().default("claude-code"),
  model: z.string().optional(),
  stallTimeout: z.number().default(300000),
  maxRetries: z.number().default(3),
  retryBaseDelay: z.number().default(60000),
});

const concurrencySchema = z.object({
  max: z.number().default(3),
});

const pollSchema = z.object({
  interval: z.number().default(30000),
  reconcileInterval: z.number().default(15000),
});

const projectSchema = z.object({
  id: z.string().optional(),
  statuses: z.object({
    todo: z.string().default("Todo"),
    inProgress: z.string().default("In Progress"),
    inReview: z.string().default("In Review"),
    done: z.string().default("Done"),
  }).default({}),
}).default({});

const workspaceSchema = z.object({
  baseDir: z.string().default("./workspaces"),
  hooks: z.object({
    setup: z.string().optional(),
    teardown: z.string().optional(),
  }).default({}),
}).default({});

const webSchema = z.object({
  port: z.number().default(3000),
  enabled: z.boolean().default(true),
}).default({});

const labelsSchema = z.object({
  eligible: z.string().default("oneagent"),
  inProgress: z.string().default("oneagent-working"),
  failed: z.string().default("oneagent-failed"),
}).default({});

export const configSchema = z.object({
  github: githubSchema,
  agent: agentSchema.default({}),
  concurrency: concurrencySchema.default({}),
  poll: pollSchema.default({}),
  project: projectSchema,
  workspace: workspaceSchema,
  labels: labelsSchema,
  web: webSchema,
});

export type Config = z.infer<typeof configSchema>;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/__tests__/schema.test.ts`
Expected: PASS

**Step 5: Write failing test for config loader**

```typescript
// src/config/__tests__/loader.test.ts
import { describe, it, expect } from "vitest";
import { loadConfigFromString } from "../loader.js";

describe("loadConfigFromString", () => {
  it("parses YAML and validates with schema", () => {
    const yaml = `
github:
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
agent:
  provider: codex
`;
    const config = loadConfigFromString(yaml);
    expect(config.agent.provider).toBe("codex");
    expect(config.web.port).toBe(3000);
  });

  it("interpolates env vars", () => {
    process.env.TEST_TOKEN = "abc123";
    const yaml = `
github:
  token: \${TEST_TOKEN}
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
`;
    const config = loadConfigFromString(yaml);
    expect(config.github.token).toBe("abc123");
    delete process.env.TEST_TOKEN;
  });

  it("throws on invalid config", () => {
    expect(() => loadConfigFromString("github: {}")).toThrow();
  });
});
```

**Step 6: Run test to verify it fails**

Run: `npx vitest run src/config/__tests__/loader.test.ts`
Expected: FAIL

**Step 7: Implement config loader**

```typescript
// src/config/loader.ts
import { parse as parseYaml } from "yaml";
import { configSchema, type Config } from "./schema.js";

function interpolateEnvVars(str: string): string {
  return str.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

export function loadConfigFromString(yamlStr: string): Config {
  const interpolated = interpolateEnvVars(yamlStr);
  const raw = parseYaml(interpolated);
  return configSchema.parse(raw);
}
```

```typescript
// src/config/defaults.ts
export const DEFAULT_CONFIG_PATH = "oneagent.yaml";
```

```typescript
// src/config/index.ts
export { configSchema, type Config } from "./schema.js";
export { loadConfigFromString } from "./loader.js";
export { DEFAULT_CONFIG_PATH } from "./defaults.js";
```

**Step 8: Run all config tests**

Run: `npx vitest run src/config/`
Expected: PASS

**Step 9: Commit**

```bash
git add src/config/ && git commit -m "feat: add config schema and YAML loader with env var interpolation"
```

---

### Task 3: Database Schema & Migrations

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/migrations.ts`
- Create: `src/db/index.ts`
- Test: `src/db/__tests__/migrations.test.ts`

**Step 1: Write failing test for database initialization**

```typescript
// src/db/__tests__/migrations.test.ts
import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";

describe("runMigrations", () => {
  let db: Database.Database;

  afterEach(() => { db?.close(); });

  it("creates all required tables", () => {
    db = new Database(":memory:");
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);
    expect(tables).toContain("runs");
    expect(tables).toContain("run_events");
    expect(tables).toContain("planning_sessions");
    expect(tables).toContain("metrics");
  });

  it("is idempotent", () => {
    db = new Database(":memory:");
    runMigrations(db);
    runMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all();
    expect(tables.length).toBeGreaterThanOrEqual(4);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/migrations.test.ts`
Expected: FAIL

**Step 3: Implement migrations**

```typescript
// src/db/schema.ts
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
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

CREATE TABLE IF NOT EXISTS run_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs(id),
  type    TEXT NOT NULL,
  payload TEXT NOT NULL,
  ts      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS planning_sessions (
  id         TEXT PRIMARY KEY,
  issue_key  TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  history    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT REFERENCES runs(id),
  provider    TEXT NOT NULL,
  model       TEXT,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  duration_ms INTEGER,
  ts          TEXT NOT NULL
);
`;
```

```typescript
// src/db/migrations.ts
import type Database from "better-sqlite3";
import { SCHEMA_SQL } from "./schema.js";

export function runMigrations(db: Database.Database): void {
  db.exec(SCHEMA_SQL);
}
```

```typescript
// src/db/index.ts
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export function createDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

export { runMigrations } from "./migrations.js";
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/migrations.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/ && git commit -m "feat: add SQLite database schema and migrations"
```

---

### Task 4: Database Access — Runs

**Files:**
- Create: `src/db/runs.ts`
- Test: `src/db/__tests__/runs.test.ts`

**Step 1: Write failing test for run persistence**

```typescript
// src/db/__tests__/runs.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";
import { RunsRepo } from "../runs.js";

describe("RunsRepo", () => {
  let db: Database.Database;
  let repo: RunsRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new RunsRepo(db);
  });
  afterEach(() => { db.close(); });

  it("inserts and retrieves a run", () => {
    repo.insert({
      id: "run1",
      issueKey: "owner/repo#1",
      provider: "claude-code",
      status: "running",
      startedAt: new Date().toISOString(),
      retryCount: 0,
    });
    const run = repo.getById("run1");
    expect(run).toBeDefined();
    expect(run!.issueKey).toBe("owner/repo#1");
  });

  it("updates run status", () => {
    repo.insert({
      id: "run2",
      issueKey: "owner/repo#2",
      provider: "codex",
      status: "running",
      startedAt: new Date().toISOString(),
      retryCount: 0,
    });
    repo.updateStatus("run2", "completed", new Date().toISOString());
    const run = repo.getById("run2");
    expect(run!.status).toBe("completed");
    expect(run!.finishedAt).toBeDefined();
  });

  it("lists runs by issue key", () => {
    const now = new Date().toISOString();
    repo.insert({ id: "r1", issueKey: "o/r#1", provider: "claude-code", status: "completed", startedAt: now, retryCount: 0 });
    repo.insert({ id: "r2", issueKey: "o/r#1", provider: "claude-code", status: "failed", startedAt: now, retryCount: 1 });
    repo.insert({ id: "r3", issueKey: "o/r#2", provider: "codex", status: "running", startedAt: now, retryCount: 0 });
    const runs = repo.listByIssue("o/r#1");
    expect(runs).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/runs.test.ts`
Expected: FAIL

**Step 3: Implement RunsRepo**

```typescript
// src/db/runs.ts
import type Database from "better-sqlite3";

export interface RunRow {
  id: string;
  issueKey: string;
  provider: string;
  model?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  retryCount: number;
  error?: string;
  tokenUsage?: string;
}

export class RunsRepo {
  constructor(private db: Database.Database) {}

  insert(run: RunRow): void {
    this.db.prepare(`
      INSERT INTO runs (id, issue_key, provider, model, status, started_at, retry_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(run.id, run.issueKey, run.provider, run.model ?? null, run.status, run.startedAt, run.retryCount);
  }

  updateStatus(id: string, status: string, finishedAt?: string, error?: string): void {
    this.db.prepare(`
      UPDATE runs SET status = ?, finished_at = ?, error = ? WHERE id = ?
    `).run(status, finishedAt ?? null, error ?? null, id);
  }

  getById(id: string): RunRow | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as any;
    return row ? this.mapRow(row) : undefined;
  }

  listByIssue(issueKey: string): RunRow[] {
    return (this.db.prepare("SELECT * FROM runs WHERE issue_key = ? ORDER BY started_at DESC").all(issueKey) as any[]).map(this.mapRow);
  }

  private mapRow(row: any): RunRow {
    return {
      id: row.id,
      issueKey: row.issue_key,
      provider: row.provider,
      model: row.model,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      retryCount: row.retry_count,
      error: row.error,
      tokenUsage: row.token_usage,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/runs.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/runs.ts src/db/__tests__/runs.test.ts && git commit -m "feat: add RunsRepo for SQLite run persistence"
```

---

### Task 5: Database Access — Run Events & Metrics

**Files:**
- Create: `src/db/run-events.ts`
- Create: `src/db/metrics.ts`
- Test: `src/db/__tests__/run-events.test.ts`
- Test: `src/db/__tests__/metrics.test.ts`

**Step 1: Write failing test for run events**

```typescript
// src/db/__tests__/run-events.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";
import { RunsRepo } from "../runs.js";
import { RunEventsRepo } from "../run-events.js";

describe("RunEventsRepo", () => {
  let db: Database.Database;
  let events: RunEventsRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    const runs = new RunsRepo(db);
    runs.insert({ id: "run1", issueKey: "o/r#1", provider: "claude-code", status: "running", startedAt: new Date().toISOString(), retryCount: 0 });
    events = new RunEventsRepo(db);
  });
  afterEach(() => { db.close(); });

  it("inserts and retrieves events", () => {
    events.insert("run1", "text", { text: "hello" });
    events.insert("run1", "tool_call", { name: "grep", args: {} });
    const list = events.listByRun("run1");
    expect(list).toHaveLength(2);
    expect(list[0].type).toBe("text");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/run-events.test.ts`
Expected: FAIL

**Step 3: Implement RunEventsRepo**

```typescript
// src/db/run-events.ts
import type Database from "better-sqlite3";

export interface RunEventRow {
  id: number;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  ts: string;
}

export class RunEventsRepo {
  constructor(private db: Database.Database) {}

  insert(runId: string, type: string, payload: Record<string, unknown>): void {
    this.db.prepare(
      "INSERT INTO run_events (run_id, type, payload, ts) VALUES (?, ?, ?, ?)"
    ).run(runId, type, JSON.stringify(payload), new Date().toISOString());
  }

  listByRun(runId: string): RunEventRow[] {
    return (this.db.prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY id").all(runId) as any[]).map((r) => ({
      id: r.id,
      runId: r.run_id,
      type: r.type,
      payload: JSON.parse(r.payload),
      ts: r.ts,
    }));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/run-events.test.ts`
Expected: PASS

**Step 5: Write failing test for metrics**

```typescript
// src/db/__tests__/metrics.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";
import { MetricsRepo } from "../metrics.js";

describe("MetricsRepo", () => {
  let db: Database.Database;
  let metrics: MetricsRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    metrics = new MetricsRepo(db);
  });
  afterEach(() => { db.close(); });

  it("records and aggregates token usage", () => {
    metrics.record({ runId: "r1", provider: "claude-code", tokensIn: 100, tokensOut: 50, durationMs: 5000 });
    metrics.record({ runId: "r2", provider: "claude-code", tokensIn: 200, tokensOut: 100, durationMs: 3000 });
    const totals = metrics.totals();
    expect(totals.tokensIn).toBe(300);
    expect(totals.tokensOut).toBe(150);
  });
});
```

**Step 6: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/metrics.test.ts`
Expected: FAIL

**Step 7: Implement MetricsRepo**

```typescript
// src/db/metrics.ts
import type Database from "better-sqlite3";

export interface MetricRecord {
  runId?: string;
  provider: string;
  model?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export class MetricsRepo {
  constructor(private db: Database.Database) {}

  record(m: MetricRecord): void {
    this.db.prepare(`
      INSERT INTO metrics (run_id, provider, model, tokens_in, tokens_out, duration_ms, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(m.runId ?? null, m.provider, m.model ?? null, m.tokensIn, m.tokensOut, m.durationMs, new Date().toISOString());
  }

  totals(): { tokensIn: number; tokensOut: number; runs: number } {
    const row = this.db.prepare(
      "SELECT COALESCE(SUM(tokens_in),0) as ti, COALESCE(SUM(tokens_out),0) as to_, COUNT(*) as c FROM metrics"
    ).get() as any;
    return { tokensIn: row.ti, tokensOut: row.to_, runs: row.c };
  }
}
```

**Step 8: Run all db tests**

Run: `npx vitest run src/db/`
Expected: PASS

**Step 9: Commit**

```bash
git add src/db/ && git commit -m "feat: add RunEventsRepo and MetricsRepo"
```

---

### Task 6: Database Access — Planning Sessions

**Files:**
- Create: `src/db/planning.ts`
- Test: `src/db/__tests__/planning.test.ts`

**Step 1: Write failing test**

```typescript
// src/db/__tests__/planning.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";
import { PlanningRepo } from "../planning.js";

describe("PlanningRepo", () => {
  let db: Database.Database;
  let repo: PlanningRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new PlanningRepo(db);
  });
  afterEach(() => { db.close(); });

  it("creates and loads a session", () => {
    repo.save("s1", [{ role: "user", content: "hello" }]);
    const history = repo.load("s1");
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("hello");
  });

  it("updates existing session", () => {
    repo.save("s1", [{ role: "user", content: "hello" }]);
    repo.save("s1", [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    const history = repo.load("s1");
    expect(history).toHaveLength(2);
  });

  it("returns empty array for unknown session", () => {
    expect(repo.load("nonexistent")).toEqual([]);
  });

  it("lists all sessions", () => {
    repo.save("s1", [{ role: "user", content: "a" }]);
    repo.save("s2", [{ role: "user", content: "b" }]);
    const sessions = repo.list();
    expect(sessions).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/planning.test.ts`
Expected: FAIL

**Step 3: Implement PlanningRepo**

```typescript
// src/db/planning.ts
import type Database from "better-sqlite3";

export interface PlanningMessage {
  role: string;
  content: string;
}

export interface PlanningSessionRow {
  id: string;
  issueKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export class PlanningRepo {
  constructor(private db: Database.Database) {}

  save(id: string, history: PlanningMessage[], issueKey?: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO planning_sessions (id, issue_key, created_at, updated_at, history)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET history = ?, updated_at = ?
    `).run(id, issueKey ?? null, now, now, JSON.stringify(history), JSON.stringify(history), now);
  }

  load(id: string): PlanningMessage[] {
    const row = this.db.prepare("SELECT history FROM planning_sessions WHERE id = ?").get(id) as any;
    return row ? JSON.parse(row.history) : [];
  }

  list(): PlanningSessionRow[] {
    return (this.db.prepare("SELECT id, issue_key, created_at, updated_at FROM planning_sessions ORDER BY updated_at DESC").all() as any[]).map((r) => ({
      id: r.id,
      issueKey: r.issue_key,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/planning.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/planning.ts src/db/__tests__/planning.test.ts && git commit -m "feat: add PlanningRepo with SessionStore-compatible interface"
```

---

### Task 7: GitHub Client — Types & REST Client

**Files:**
- Create: `src/github/types.ts`
- Create: `src/github/client.ts`
- Create: `src/github/index.ts`
- Test: `src/github/__tests__/client.test.ts`

**Step 1: Write failing test for GitHub client**

```typescript
// src/github/__tests__/client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubClient } from "../client.js";

describe("GitHubClient", () => {
  it("constructs issue key from owner/repo/number", () => {
    const client = new GitHubClient("fake-token");
    expect(client.issueKey("owner", "repo", 42)).toBe("owner/repo#42");
  });

  it("parses issue key", () => {
    const client = new GitHubClient("fake-token");
    const parsed = client.parseIssueKey("owner/repo#42");
    expect(parsed).toEqual({ owner: "owner", repo: "repo", number: 42 });
  });

  it("returns null for invalid issue key", () => {
    const client = new GitHubClient("fake-token");
    expect(client.parseIssueKey("invalid")).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/github/__tests__/client.test.ts`
Expected: FAIL

**Step 3: Implement types and client**

```typescript
// src/github/types.ts
export interface Issue {
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: string;
  hasOpenPR: boolean;
}

export interface PullRequest {
  key: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  headRef: string;
  state: string;
  labels: string[];
}

export interface CheckRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
}
```

```typescript
// src/github/client.ts
import { Octokit } from "octokit";
import type { Issue, PullRequest, CheckRun } from "./types.js";

export class GitHubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  issueKey(owner: string, repo: string, number: number): string {
    return `${owner}/${repo}#${number}`;
  }

  parseIssueKey(key: string): { owner: string; repo: string; number: number } | null {
    const match = key.match(/^(.+)\/(.+)#(\d+)$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) };
  }

  async fetchIssues(owner: string, repo: string, label: string): Promise<Issue[]> {
    const { data } = await this.octokit.rest.issues.listForRepo({
      owner, repo, labels: label, state: "open", per_page: 100,
    });
    return data
      .filter((i) => !i.pull_request)
      .map((i) => ({
        key: this.issueKey(owner, repo, i.number),
        owner, repo,
        number: i.number,
        title: i.title,
        body: i.body ?? "",
        labels: i.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
        state: i.state,
        hasOpenPR: false,
      }));
  }

  async addLabel(owner: string, repo: string, number: number, label: string): Promise<void> {
    await this.octokit.rest.issues.addLabels({ owner, repo, issue_number: number, labels: [label] });
  }

  async removeLabel(owner: string, repo: string, number: number, label: string): Promise<void> {
    try {
      await this.octokit.rest.issues.removeLabel({ owner, repo, issue_number: number, name: label });
    } catch { /* label may not exist */ }
  }

  async fetchPRsWithLabel(owner: string, repo: string, label: string): Promise<PullRequest[]> {
    const { data } = await this.octokit.rest.pulls.list({ owner, repo, state: "open", per_page: 100 });
    return data
      .filter((pr) => pr.labels.some((l) => l.name === label))
      .map((pr) => ({
        key: this.issueKey(owner, repo, pr.number),
        owner, repo,
        number: pr.number,
        title: pr.title,
        headRef: pr.head.ref,
        state: pr.state,
        labels: pr.labels.map((l) => l.name ?? ""),
      }));
  }

  async fetchCheckRuns(owner: string, repo: string, ref: string): Promise<CheckRun[]> {
    const { data } = await this.octokit.rest.checks.listForRef({ owner, repo, ref });
    return data.check_runs.map((cr) => ({
      id: cr.id,
      name: cr.name,
      status: cr.status,
      conclusion: cr.conclusion,
    }));
  }
}
```

```typescript
// src/github/index.ts
export { GitHubClient } from "./client.js";
export type { Issue, PullRequest, CheckRun } from "./types.js";
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/github/__tests__/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/github/ && git commit -m "feat: add GitHub client with octokit for issues, PRs, and check runs"
```

---

### Task 8: Workspace Manager

**Files:**
- Create: `src/workspace/manager.ts`
- Create: `src/workspace/hooks.ts`
- Create: `src/workspace/index.ts`
- Test: `src/workspace/__tests__/manager.test.ts`

**Step 1: Write failing test**

```typescript
// src/workspace/__tests__/manager.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { WorkspaceManager } from "../manager.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("WorkspaceManager", () => {
  let baseDir: string;

  afterEach(() => {
    if (baseDir) rmSync(baseDir, { recursive: true, force: true });
  });

  it("creates workspace directory for an issue", () => {
    baseDir = mkdtempSync(join(tmpdir(), "ws-test-"));
    const mgr = new WorkspaceManager(baseDir);
    const dir = mgr.ensure("owner/repo#42");
    expect(existsSync(dir)).toBe(true);
    expect(dir).toContain("owner-repo-42");
  });

  it("returns same directory on repeated calls", () => {
    baseDir = mkdtempSync(join(tmpdir(), "ws-test-"));
    const mgr = new WorkspaceManager(baseDir);
    const dir1 = mgr.ensure("owner/repo#1");
    const dir2 = mgr.ensure("owner/repo#1");
    expect(dir1).toBe(dir2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/workspace/__tests__/manager.test.ts`
Expected: FAIL

**Step 3: Implement workspace manager**

```typescript
// src/workspace/manager.ts
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export class WorkspaceManager {
  constructor(private baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
  }

  ensure(issueKey: string): string {
    const dirName = issueKey.replace(/[/#]/g, "-");
    const dir = join(this.baseDir, dirName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  path(issueKey: string): string {
    return join(this.baseDir, issueKey.replace(/[/#]/g, "-"));
  }
}
```

```typescript
// src/workspace/hooks.ts
import { execSync } from "node:child_process";
import type { Logger } from "pino";

export function runHook(script: string | undefined, cwd: string, logger: Logger): void {
  if (!script) return;
  try {
    execSync(script, { cwd, stdio: "pipe", timeout: 30000 });
  } catch (err) {
    logger.warn({ err, script, cwd }, "workspace hook failed");
  }
}
```

```typescript
// src/workspace/index.ts
export { WorkspaceManager } from "./manager.js";
export { runHook } from "./hooks.js";
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/workspace/__tests__/manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/workspace/ && git commit -m "feat: add workspace manager and lifecycle hooks"
```

---

### Task 9: Agent Definitions — Coder & Skill Agents

**Files:**
- Create: `src/agents/coder.ts`
- Create: `src/agents/skills/tdd.ts`
- Create: `src/agents/skills/debugger.ts`
- Create: `src/agents/skills/reviewer.ts`
- Create: `src/agents/skills/pr-workflow.ts`
- Create: `src/agents/graph.ts`
- Create: `src/agents/prompts.ts`
- Create: `src/agents/index.ts`
- Test: `src/agents/__tests__/graph.test.ts`

**Step 1: Write failing test for agent graph**

```typescript
// src/agents/__tests__/graph.test.ts
import { describe, it, expect } from "vitest";
import { buildAgentGraph } from "../graph.js";

describe("buildAgentGraph", () => {
  it("returns a map with all agents", () => {
    const graph = buildAgentGraph();
    expect(graph.has("coder")).toBe(true);
    expect(graph.has("tdd")).toBe(true);
    expect(graph.has("debugger")).toBe(true);
    expect(graph.has("reviewer")).toBe(true);
    expect(graph.has("pr-workflow")).toBe(true);
    expect(graph.has("planner")).toBe(true);
  });

  it("coder agent declares handoffs to all skill agents", () => {
    const graph = buildAgentGraph();
    const coder = graph.get("coder")!;
    expect(coder.handoffs).toContain("tdd");
    expect(coder.handoffs).toContain("debugger");
    expect(coder.handoffs).toContain("reviewer");
    expect(coder.handoffs).toContain("pr-workflow");
    expect(coder.handoffs).toContain("planner");
  });

  it("skill agents hand back to coder", () => {
    const graph = buildAgentGraph();
    const tdd = graph.get("tdd")!;
    expect(tdd.handoffs).toContain("coder");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/agents/__tests__/graph.test.ts`
Expected: FAIL

**Step 3: Implement agent prompts**

```typescript
// src/agents/prompts.ts

export const CODER_PROMPT = `You are a skilled software engineer working on a GitHub issue.

Your workflow:
1. Read and understand the issue requirements
2. Explore the codebase to understand existing patterns
3. Write code that solves the issue
4. Run tests to verify your changes work
5. Commit and push your changes

You can hand off to specialist agents when needed:
- Hand off to "tdd" when you need to follow strict test-driven development
- Hand off to "debugger" when you encounter a bug that needs systematic investigation
- Hand off to "reviewer" before creating a pull request to get a code review
- Hand off to "pr-workflow" to create and manage the pull request
- Hand off to "planner" when the issue is complex and needs a structured plan first

Always write clean, well-tested code that follows existing project conventions.`;

export const TDD_PROMPT = `You are a TDD specialist. You enforce strict test-driven development:

1. Write a failing test that captures the requirement
2. Run the test — confirm it fails for the right reason
3. Write the minimal code to make it pass
4. Run the test — confirm it passes
5. Refactor if needed, keeping tests green
6. Repeat for each requirement

When all requirements are covered with passing tests, hand back to "coder".
Never write implementation code without a failing test first.`;

export const DEBUGGER_PROMPT = `You are a systematic debugging specialist:

1. Reproduce the bug — get a failing test or observable failure
2. Form a hypothesis about the root cause
3. Gather evidence — read code, add logging, check state
4. Verify or refute the hypothesis
5. Fix the root cause (not symptoms)
6. Verify the fix with a test

When the bug is fixed and verified, hand back to "coder".`;

export const REVIEWER_PROMPT = `You are a code reviewer. Review the changes for:

1. Correctness — does the code do what it claims?
2. Security — any injection, auth bypass, or data exposure risks?
3. Quality — readable, maintainable, follows project conventions?
4. Testing — are edge cases covered?
5. Performance — any obvious bottlenecks?

Provide specific, actionable feedback. When the review is complete, hand back to "coder" with your findings.`;

export const PR_WORKFLOW_PROMPT = `You manage pull request lifecycle:

1. Create a well-formatted PR with title, description, and test plan
2. Push changes to the correct branch
3. If CI fails, analyze the failure logs and push fixes
4. Ensure the PR is ready for human review

When the PR is created and CI is green, hand back to "coder".`;

export const PLANNER_PROMPT = `You are a planning specialist for complex issues:

1. Break down the issue into phases and tasks
2. Identify dependencies between tasks
3. Estimate relative complexity
4. Define acceptance criteria for each task
5. Produce a structured plan

Use the create-plan and refine-plan tools to build and iterate on plans.
When planning is complete, hand back to "coder" with the finalized plan.`;
```

**Step 4: Implement agent definitions**

```typescript
// src/agents/coder.ts
import { defineAgent } from "one-agent-sdk";
import { CODER_PROMPT } from "./prompts.js";

export const coderAgent = defineAgent({
  name: "coder",
  description: "Primary coding agent that works on GitHub issues",
  prompt: CODER_PROMPT,
  handoffs: ["tdd", "debugger", "reviewer", "pr-workflow", "planner"],
});
```

```typescript
// src/agents/skills/tdd.ts
import { defineAgent } from "one-agent-sdk";
import { TDD_PROMPT } from "../prompts.js";

export const tddAgent = defineAgent({
  name: "tdd",
  description: "TDD specialist — enforces test-driven development workflow",
  prompt: TDD_PROMPT,
  handoffs: ["coder"],
});
```

```typescript
// src/agents/skills/debugger.ts
import { defineAgent } from "one-agent-sdk";
import { DEBUGGER_PROMPT } from "../prompts.js";

export const debuggerAgent = defineAgent({
  name: "debugger",
  description: "Systematic debugging specialist",
  prompt: DEBUGGER_PROMPT,
  handoffs: ["coder"],
});
```

```typescript
// src/agents/skills/reviewer.ts
import { defineAgent } from "one-agent-sdk";
import { REVIEWER_PROMPT } from "../prompts.js";

export const reviewerAgent = defineAgent({
  name: "reviewer",
  description: "Code review specialist",
  prompt: REVIEWER_PROMPT,
  handoffs: ["coder"],
});
```

```typescript
// src/agents/skills/pr-workflow.ts
import { defineAgent } from "one-agent-sdk";
import { PR_WORKFLOW_PROMPT } from "../prompts.js";

export const prWorkflowAgent = defineAgent({
  name: "pr-workflow",
  description: "PR creation and CI monitoring specialist",
  prompt: PR_WORKFLOW_PROMPT,
  handoffs: ["coder"],
});
```

**Step 5: Implement planner agent**

```typescript
// src/agents/planner.ts
import { defineAgent } from "one-agent-sdk";
import { PLANNER_PROMPT } from "./prompts.js";

export const plannerAgent = defineAgent({
  name: "planner",
  description: "Planning specialist for complex issues",
  prompt: PLANNER_PROMPT,
  handoffs: ["coder"],
});
```

**Step 6: Implement agent graph builder**

```typescript
// src/agents/graph.ts
import { coderAgent } from "./coder.js";
import { tddAgent } from "./skills/tdd.js";
import { debuggerAgent } from "./skills/debugger.js";
import { reviewerAgent } from "./skills/reviewer.js";
import { prWorkflowAgent } from "./skills/pr-workflow.js";
import { plannerAgent } from "./planner.js";

export type AgentDef = { name: string; handoffs?: string[]; [key: string]: unknown };

export function buildAgentGraph(): Map<string, AgentDef> {
  const agents: AgentDef[] = [
    coderAgent,
    tddAgent,
    debuggerAgent,
    reviewerAgent,
    prWorkflowAgent,
    plannerAgent,
  ];
  return new Map(agents.map((a) => [a.name, a]));
}
```

```typescript
// src/agents/index.ts
export { coderAgent } from "./coder.js";
export { plannerAgent } from "./planner.js";
export { buildAgentGraph } from "./graph.js";
export { tddAgent } from "./skills/tdd.js";
export { debuggerAgent } from "./skills/debugger.js";
export { reviewerAgent } from "./skills/reviewer.js";
export { prWorkflowAgent } from "./skills/pr-workflow.js";
```

**Step 7: Run test to verify it passes**

Run: `npx vitest run src/agents/__tests__/graph.test.ts`
Expected: PASS

**Step 8: Commit**

```bash
git add src/agents/ && git commit -m "feat: add agent definitions with multi-agent handoff graph"
```

---

### Task 10: Orchestrator — State & Retry Queue

**Files:**
- Create: `src/orchestrator/state.ts`
- Create: `src/orchestrator/retry.ts`
- Test: `src/orchestrator/__tests__/state.test.ts`
- Test: `src/orchestrator/__tests__/retry.test.ts`

**Step 1: Write failing test for state**

```typescript
// src/orchestrator/__tests__/state.test.ts
import { describe, it, expect } from "vitest";
import { RunState, type RunEntry } from "../state.js";

describe("RunState", () => {
  it("tracks active runs", () => {
    const state = new RunState();
    state.add("o/r#1", { runId: "r1", issueKey: "o/r#1", provider: "claude-code", startedAt: new Date(), lastActivity: new Date(), retryCount: 0 });
    expect(state.isRunning("o/r#1")).toBe(true);
    expect(state.activeCount()).toBe(1);
  });

  it("removes completed runs", () => {
    const state = new RunState();
    state.add("o/r#1", { runId: "r1", issueKey: "o/r#1", provider: "claude-code", startedAt: new Date(), lastActivity: new Date(), retryCount: 0 });
    state.remove("o/r#1");
    expect(state.isRunning("o/r#1")).toBe(false);
    expect(state.activeCount()).toBe(0);
  });

  it("iterates running entries", () => {
    const state = new RunState();
    state.add("o/r#1", { runId: "r1", issueKey: "o/r#1", provider: "claude-code", startedAt: new Date(), lastActivity: new Date(), retryCount: 0 });
    state.add("o/r#2", { runId: "r2", issueKey: "o/r#2", provider: "codex", startedAt: new Date(), lastActivity: new Date(), retryCount: 0 });
    const entries = [...state.running()];
    expect(entries).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/orchestrator/__tests__/state.test.ts`
Expected: FAIL

**Step 3: Implement RunState**

```typescript
// src/orchestrator/state.ts
export interface RunEntry {
  runId: string;
  issueKey: string;
  provider: string;
  model?: string;
  startedAt: Date;
  lastActivity: Date;
  retryCount: number;
  abortController?: AbortController;
}

export class RunState {
  private runs = new Map<string, RunEntry>();

  add(issueKey: string, entry: RunEntry): void {
    this.runs.set(issueKey, entry);
  }

  remove(issueKey: string): RunEntry | undefined {
    const entry = this.runs.get(issueKey);
    this.runs.delete(issueKey);
    return entry;
  }

  get(issueKey: string): RunEntry | undefined {
    return this.runs.get(issueKey);
  }

  isRunning(issueKey: string): boolean {
    return this.runs.has(issueKey);
  }

  activeCount(): number {
    return this.runs.size;
  }

  running(): IterableIterator<[string, RunEntry]> {
    return this.runs.entries();
  }

  updateActivity(issueKey: string): void {
    const entry = this.runs.get(issueKey);
    if (entry) entry.lastActivity = new Date();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/orchestrator/__tests__/state.test.ts`
Expected: PASS

**Step 5: Write failing test for retry queue**

```typescript
// src/orchestrator/__tests__/retry.test.ts
import { describe, it, expect } from "vitest";
import { RetryQueue } from "../retry.js";

describe("RetryQueue", () => {
  it("queues items with exponential backoff", () => {
    const q = new RetryQueue(1000, 3);
    q.enqueue("o/r#1", 0);
    expect(q.size()).toBe(1);
  });

  it("returns due items", () => {
    const q = new RetryQueue(0, 3); // 0ms base delay = immediately due
    q.enqueue("o/r#1", 0);
    const due = q.due();
    expect(due).toContain("o/r#1");
  });

  it("does not return items not yet due", () => {
    const q = new RetryQueue(999999, 3); // very long delay
    q.enqueue("o/r#1", 0);
    const due = q.due();
    expect(due).toHaveLength(0);
  });

  it("returns false for exhausted retries", () => {
    const q = new RetryQueue(1000, 3);
    expect(q.canRetry(3)).toBe(false);
    expect(q.canRetry(2)).toBe(true);
  });

  it("removes items when dequeued", () => {
    const q = new RetryQueue(0, 3);
    q.enqueue("o/r#1", 0);
    q.dequeue("o/r#1");
    expect(q.size()).toBe(0);
  });
});
```

**Step 6: Run test to verify it fails**

Run: `npx vitest run src/orchestrator/__tests__/retry.test.ts`
Expected: FAIL

**Step 7: Implement RetryQueue**

```typescript
// src/orchestrator/retry.ts
interface RetryEntry {
  issueKey: string;
  retryCount: number;
  nextAttempt: number; // timestamp ms
}

export class RetryQueue {
  private queue = new Map<string, RetryEntry>();

  constructor(
    private baseDelayMs: number,
    private maxRetries: number,
  ) {}

  enqueue(issueKey: string, retryCount: number): void {
    const delay = this.baseDelayMs * Math.pow(2, retryCount);
    this.queue.set(issueKey, {
      issueKey,
      retryCount: retryCount + 1,
      nextAttempt: Date.now() + delay,
    });
  }

  dequeue(issueKey: string): void {
    this.queue.delete(issueKey);
  }

  due(): string[] {
    const now = Date.now();
    return [...this.queue.values()]
      .filter((e) => e.nextAttempt <= now)
      .map((e) => e.issueKey);
  }

  getRetryCount(issueKey: string): number {
    return this.queue.get(issueKey)?.retryCount ?? 0;
  }

  canRetry(retryCount: number): boolean {
    return retryCount < this.maxRetries;
  }

  size(): number {
    return this.queue.size;
  }
}
```

**Step 8: Run all orchestrator tests**

Run: `npx vitest run src/orchestrator/`
Expected: PASS

**Step 9: Commit**

```bash
git add src/orchestrator/ && git commit -m "feat: add RunState and RetryQueue for orchestrator"
```

---

### Task 11: Middleware — Stall Detector & Event Bridge

**Files:**
- Create: `src/middleware/stall-detector.ts`
- Create: `src/middleware/event-bridge.ts`
- Create: `src/middleware/logging.ts`
- Create: `src/middleware/index.ts`
- Test: `src/middleware/__tests__/stall-detector.test.ts`

**Step 1: Write failing test for stall detector**

```typescript
// src/middleware/__tests__/stall-detector.test.ts
import { describe, it, expect, vi } from "vitest";
import { createStallDetector } from "../stall-detector.js";

describe("createStallDetector", () => {
  it("calls onStall when no chunks arrive within timeout", async () => {
    const onStall = vi.fn();
    const detector = createStallDetector(50, onStall); // 50ms timeout
    detector.start();
    await new Promise((r) => setTimeout(r, 100));
    expect(onStall).toHaveBeenCalled();
    detector.stop();
  });

  it("resets timer on activity", async () => {
    const onStall = vi.fn();
    const detector = createStallDetector(100, onStall);
    detector.start();
    await new Promise((r) => setTimeout(r, 50));
    detector.activity(); // reset
    await new Promise((r) => setTimeout(r, 50));
    detector.activity(); // reset again
    expect(onStall).not.toHaveBeenCalled();
    detector.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/middleware/__tests__/stall-detector.test.ts`
Expected: FAIL

**Step 3: Implement stall detector**

```typescript
// src/middleware/stall-detector.ts
export interface StallDetector {
  start(): void;
  stop(): void;
  activity(): void;
}

export function createStallDetector(
  timeoutMs: number,
  onStall: () => void,
): StallDetector {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    start() {
      timer = setTimeout(onStall, timeoutMs);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    activity() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onStall, timeoutMs);
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/middleware/__tests__/stall-detector.test.ts`
Expected: PASS

**Step 5: Implement event bridge and logging**

```typescript
// src/middleware/event-bridge.ts
import type { EventEmitter } from "node:events";
import type { RunEventsRepo } from "../db/run-events.js";

export interface StreamChunkLike {
  type: string;
  [key: string]: unknown;
}

export function bridgeChunkToSSE(
  chunk: StreamChunkLike,
  runId: string,
  sseHub: EventEmitter,
  eventsRepo?: RunEventsRepo,
): void {
  const eventType = `agent:${chunk.type}`;
  sseHub.emit("sse", { type: eventType, data: { runId, ...chunk } });
  eventsRepo?.insert(runId, chunk.type, chunk as Record<string, unknown>);
}
```

```typescript
// src/middleware/logging.ts
import type { Logger } from "pino";
import type { StreamChunkLike } from "./event-bridge.js";

export function logChunk(chunk: StreamChunkLike, runId: string, logger: Logger): void {
  logger.debug({ runId, chunkType: chunk.type }, "agent chunk");
}
```

```typescript
// src/middleware/index.ts
export { createStallDetector, type StallDetector } from "./stall-detector.js";
export { bridgeChunkToSSE, type StreamChunkLike } from "./event-bridge.js";
export { logChunk } from "./logging.js";
```

**Step 6: Run all middleware tests**

Run: `npx vitest run src/middleware/`
Expected: PASS

**Step 7: Commit**

```bash
git add src/middleware/ && git commit -m "feat: add stall detector, event bridge, and logging middleware"
```

---

### Task 12: Orchestrator — Dispatcher

**Files:**
- Create: `src/orchestrator/dispatcher.ts`
- Test: `src/orchestrator/__tests__/dispatcher.test.ts`

**Step 1: Write failing test for dispatcher**

```typescript
// src/orchestrator/__tests__/dispatcher.test.ts
import { describe, it, expect, vi } from "vitest";
import { Dispatcher } from "../dispatcher.js";

describe("Dispatcher", () => {
  it("builds a prompt from an issue", () => {
    const dispatcher = new Dispatcher();
    const prompt = dispatcher.buildPrompt({
      key: "o/r#1",
      owner: "o",
      repo: "r",
      number: 1,
      title: "Fix the bug",
      body: "The button is broken",
      labels: ["oneagent"],
      state: "open",
      hasOpenPR: false,
    });
    expect(prompt).toContain("Fix the bug");
    expect(prompt).toContain("The button is broken");
    expect(prompt).toContain("o/r#1");
  });

  it("builds a PR fix prompt", () => {
    const dispatcher = new Dispatcher();
    const prompt = dispatcher.buildPRFixPrompt({
      key: "o/r#10",
      owner: "o",
      repo: "r",
      number: 10,
      title: "Add feature",
      headRef: "feature-branch",
      state: "open",
      labels: ["oneagent"],
    }, "Error: test failed on line 42");
    expect(prompt).toContain("feature-branch");
    expect(prompt).toContain("test failed on line 42");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/orchestrator/__tests__/dispatcher.test.ts`
Expected: FAIL

**Step 3: Implement Dispatcher**

```typescript
// src/orchestrator/dispatcher.ts
import type { Issue, PullRequest } from "../github/types.js";

export class Dispatcher {
  buildPrompt(issue: Issue): string {
    return `## GitHub Issue: ${issue.key}

**Title:** ${issue.title}

**Description:**
${issue.body}

**Repository:** ${issue.owner}/${issue.repo}
**Issue Number:** #${issue.number}
**Labels:** ${issue.labels.join(", ")}

Work on this issue. Read the codebase, understand the requirements, implement the solution, write tests, and prepare for a pull request.`;
  }

  buildPRFixPrompt(pr: PullRequest, failureLogs: string): string {
    return `## CI Failure Fix: ${pr.key}

**PR Title:** ${pr.title}
**Branch:** ${pr.headRef}
**Repository:** ${pr.owner}/${pr.repo}

**CI Failure Logs:**
\`\`\`
${failureLogs}
\`\`\`

Analyze the CI failure, fix the issue on branch \`${pr.headRef}\`, and push the fix.`;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/orchestrator/__tests__/dispatcher.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator/dispatcher.ts src/orchestrator/__tests__/dispatcher.test.ts && git commit -m "feat: add Dispatcher with prompt building for issues and PR fixes"
```

---

### Task 13: Orchestrator — Main Loop

**Files:**
- Create: `src/orchestrator/orchestrator.ts`
- Create: `src/orchestrator/index.ts`
- Test: `src/orchestrator/__tests__/orchestrator.test.ts`

**Step 1: Write failing test for orchestrator lifecycle**

```typescript
// src/orchestrator/__tests__/orchestrator.test.ts
import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../orchestrator.js";

const mockGitHub = {
  fetchIssues: vi.fn().mockResolvedValue([]),
  addLabel: vi.fn().mockResolvedValue(undefined),
  removeLabel: vi.fn().mockResolvedValue(undefined),
  issueKey: (o: string, r: string, n: number) => `${o}/${r}#${n}`,
};

const mockConfig = {
  github: { repos: [{ owner: "o", repo: "r", labels: ["oneagent"] }] },
  agent: { provider: "claude-code", stallTimeout: 300000, maxRetries: 3, retryBaseDelay: 60000 },
  concurrency: { max: 3 },
  poll: { interval: 30000, reconcileInterval: 15000 },
  labels: { eligible: "oneagent", inProgress: "oneagent-working", failed: "oneagent-failed" },
  workspace: { baseDir: "/tmp/test-ws", hooks: {} },
  web: { port: 3000, enabled: false },
  project: { statuses: { todo: "Todo", inProgress: "In Progress", inReview: "In Review", done: "Done" } },
};

describe("Orchestrator", () => {
  it("can be constructed", () => {
    const orch = new Orchestrator(mockConfig as any, mockGitHub as any);
    expect(orch).toBeDefined();
  });

  it("tick fetches issues from all repos", async () => {
    const orch = new Orchestrator(mockConfig as any, mockGitHub as any);
    await orch.tick();
    expect(mockGitHub.fetchIssues).toHaveBeenCalledWith("o", "r", "oneagent");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/orchestrator/__tests__/orchestrator.test.ts`
Expected: FAIL

**Step 3: Implement Orchestrator**

```typescript
// src/orchestrator/orchestrator.ts
import { EventEmitter } from "node:events";
import type { Config } from "../config/schema.js";
import type { GitHubClient } from "../github/client.js";
import type { Issue } from "../github/types.js";
import { RunState, type RunEntry } from "./state.js";
import { RetryQueue } from "./retry.js";
import { Dispatcher } from "./dispatcher.js";
import { ulid } from "ulid";

export class Orchestrator {
  readonly state = new RunState();
  readonly retryQueue: RetryQueue;
  readonly sseHub = new EventEmitter();
  private dispatcher = new Dispatcher();
  private pollTimer?: ReturnType<typeof setInterval>;
  private reconcileTimer?: ReturnType<typeof setInterval>;

  constructor(
    private config: Config,
    private github: GitHubClient,
  ) {
    this.retryQueue = new RetryQueue(
      config.agent.retryBaseDelay,
      config.agent.maxRetries,
    );
  }

  start(): void {
    this.pollTimer = setInterval(() => this.tick(), this.config.poll.interval);
    this.reconcileTimer = setInterval(() => this.reconcile(), this.config.poll.reconcileInterval);
    this.tick();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    for (const [key, entry] of this.state.running()) {
      entry.abortController?.abort();
    }
  }

  async tick(): Promise<void> {
    const allIssues: Issue[] = [];
    for (const repo of this.config.github.repos) {
      for (const label of repo.labels) {
        const issues = await this.github.fetchIssues(repo.owner, repo.repo, label);
        allIssues.push(...issues);
      }
    }

    const retryKeys = this.retryQueue.due();

    for (const issue of allIssues) {
      if (this.state.isRunning(issue.key)) continue;
      if (this.state.activeCount() >= this.config.concurrency.max) break;
      if (issue.hasOpenPR) continue;

      await this.dispatch(issue);
    }

    for (const key of retryKeys) {
      if (this.state.isRunning(key)) continue;
      if (this.state.activeCount() >= this.config.concurrency.max) break;
      this.retryQueue.dequeue(key);
      // Re-fetch the issue to dispatch
      const parsed = this.github.parseIssueKey(key);
      if (!parsed) continue;
      const issues = await this.github.fetchIssues(parsed.owner, parsed.repo, this.config.labels.eligible);
      const issue = issues.find((i) => i.key === key);
      if (issue) await this.dispatch(issue);
    }
  }

  private async dispatch(issue: Issue): Promise<void> {
    const runId = ulid();
    const abortController = new AbortController();

    const entry: RunEntry = {
      runId,
      issueKey: issue.key,
      provider: this.config.agent.provider,
      startedAt: new Date(),
      lastActivity: new Date(),
      retryCount: this.retryQueue.getRetryCount(issue.key),
      abortController,
    };

    this.state.add(issue.key, entry);
    await this.github.addLabel(issue.owner, issue.repo, issue.number, this.config.labels.inProgress);

    const prompt = this.dispatcher.buildPrompt(issue);

    this.sseHub.emit("sse", {
      type: "agent:started",
      data: { runId, issueKey: issue.key, provider: entry.provider },
    });

    // Agent execution will be wired in the integration task
    // For now, the dispatch sets up state and labels
  }

  async reconcile(): Promise<void> {
    for (const [key, entry] of this.state.running()) {
      const parsed = this.github.parseIssueKey(key);
      if (!parsed) continue;

      // Check if the issue should stop
      // Full implementation will check: closed, label removed, PR opened
      // Stub for now — real reconciliation added in integration task
    }
  }
}
```

```typescript
// src/orchestrator/index.ts
export { Orchestrator } from "./orchestrator.js";
export { RunState, type RunEntry } from "./state.js";
export { RetryQueue } from "./retry.js";
export { Dispatcher } from "./dispatcher.js";
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/orchestrator/__tests__/orchestrator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/orchestrator/ && git commit -m "feat: add Orchestrator with poll-dispatch-reconcile loop"
```

---

### Task 14: SSE Hub

**Files:**
- Create: `src/web/sse.ts`
- Test: `src/web/__tests__/sse.test.ts`

**Step 1: Write failing test**

```typescript
// src/web/__tests__/sse.test.ts
import { describe, it, expect, vi } from "vitest";
import { SSEHub } from "../sse.js";

describe("SSEHub", () => {
  it("broadcasts events to subscribers", () => {
    const hub = new SSEHub();
    const listener = vi.fn();
    hub.subscribe(listener);
    hub.broadcast("agent:started", { runId: "r1" });
    expect(listener).toHaveBeenCalledWith("agent:started", { runId: "r1" });
  });

  it("removes unsubscribed listeners", () => {
    const hub = new SSEHub();
    const listener = vi.fn();
    const unsub = hub.subscribe(listener);
    unsub();
    hub.broadcast("agent:started", { runId: "r1" });
    expect(listener).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/__tests__/sse.test.ts`
Expected: FAIL

**Step 3: Implement SSEHub**

```typescript
// src/web/sse.ts
type SSEListener = (event: string, data: unknown) => void;

export class SSEHub {
  private listeners = new Set<SSEListener>();

  subscribe(listener: SSEListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  broadcast(event: string, data: unknown): void {
    for (const listener of this.listeners) {
      listener(event, data);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/web/__tests__/sse.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/web/ && git commit -m "feat: add SSEHub for real-time event broadcasting"
```

---

### Task 15: Web App — Hono Setup & API Routes

**Files:**
- Create: `src/web/app.ts`
- Create: `src/web/routes/api.ts`
- Create: `src/web/index.ts`
- Test: `src/web/__tests__/api.test.ts`

**Step 1: Write failing test**

```typescript
// src/web/__tests__/api.test.ts
import { describe, it, expect } from "vitest";
import { createApp } from "../app.js";
import { SSEHub } from "../sse.js";

describe("API routes", () => {
  it("POST /api/v1/refresh returns 200", async () => {
    const app = createApp({
      sseHub: new SSEHub(),
      onRefresh: async () => {},
      getState: () => ({ running: [], retryQueue: [], metrics: { tokensIn: 0, tokensOut: 0, runs: 0 } }),
    });
    const res = await app.request("/api/v1/refresh", { method: "POST" });
    expect(res.status).toBe(200);
  });

  it("GET /api/v1/status returns state", async () => {
    const app = createApp({
      sseHub: new SSEHub(),
      onRefresh: async () => {},
      getState: () => ({
        running: [{ runId: "r1", issueKey: "o/r#1", provider: "claude-code" }],
        retryQueue: [],
        metrics: { tokensIn: 100, tokensOut: 50, runs: 1 },
      }),
    });
    const res = await app.request("/api/v1/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.running).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/web/__tests__/api.test.ts`
Expected: FAIL

**Step 3: Implement web app and API routes**

```typescript
// src/web/routes/api.ts
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEHub } from "../sse.js";

export interface AppContext {
  sseHub: SSEHub;
  onRefresh: () => Promise<void>;
  getState: () => {
    running: Array<{ runId: string; issueKey: string; provider: string }>;
    retryQueue: string[];
    metrics: { tokensIn: number; tokensOut: number; runs: number };
  };
}

export function apiRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.post("/refresh", async (c) => {
    await ctx.onRefresh();
    return c.json({ ok: true });
  });

  api.get("/status", (c) => {
    return c.json(ctx.getState());
  });

  api.get("/events", (c) => {
    return streamSSE(c, async (stream) => {
      const unsub = ctx.sseHub.subscribe((event, data) => {
        stream.writeSSE({ event, data: JSON.stringify(data) });
      });
      // Keep connection open until client disconnects
      await new Promise((resolve) => {
        c.req.raw.signal.addEventListener("abort", resolve);
      });
      unsub();
    });
  });

  return api;
}
```

```typescript
// src/web/app.ts
import { Hono } from "hono";
import { apiRoutes, type AppContext } from "./routes/api.js";

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();
  app.route("/api/v1", apiRoutes(ctx));
  return app;
}
```

```typescript
// src/web/index.ts
export { createApp } from "./app.js";
export { SSEHub } from "./sse.js";
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/web/__tests__/api.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/web/ && git commit -m "feat: add Hono web app with API routes and SSE streaming"
```

---

### Task 16: Web App — Dashboard & Sprint Board Pages

**Files:**
- Create: `src/web/routes/dashboard.tsx`
- Create: `src/web/routes/sprint.tsx`
- Create: `src/web/routes/issues.tsx`
- Create: `src/web/routes/settings.tsx`
- Create: `src/web/components/layout.tsx`

**Step 1: Implement shared layout component**

```tsx
// src/web/components/layout.tsx
import type { FC, PropsWithChildren } from "hono/jsx";

export const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} — OneAgent</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-gray-900 text-gray-100 min-h-screen">
      <nav class="bg-gray-800 border-b border-gray-700 px-6 py-3 flex gap-6">
        <a href="/" class="font-bold text-white">OneAgent</a>
        <a href="/sprint" class="text-gray-300 hover:text-white">Sprint</a>
        <a href="/planning" class="text-gray-300 hover:text-white">Planning</a>
        <a href="/settings" class="text-gray-300 hover:text-white">Settings</a>
      </nav>
      <main class="p-6">{children}</main>
      <script dangerouslySetInnerHTML={{ __html: `
        const es = new EventSource('/api/v1/events');
        es.onmessage = (e) => {
          const event = JSON.parse(e.data);
          document.dispatchEvent(new CustomEvent('sse', { detail: event }));
        };
      `}} />
    </body>
  </html>
);
```

**Step 2: Implement dashboard page**

```tsx
// src/web/routes/dashboard.tsx
import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import type { AppContext } from "./api.js";

export function dashboardRoute(ctx: AppContext): Hono {
  const route = new Hono();

  route.get("/", (c) => {
    const state = ctx.getState();
    return c.html(
      <Layout title="Dashboard">
        <div class="grid grid-cols-3 gap-4 mb-8">
          <div class="bg-gray-800 rounded-lg p-4">
            <div class="text-sm text-gray-400">Active Agents</div>
            <div class="text-3xl font-bold">{state.running.length}</div>
          </div>
          <div class="bg-gray-800 rounded-lg p-4">
            <div class="text-sm text-gray-400">Total Runs</div>
            <div class="text-3xl font-bold">{state.metrics.runs}</div>
          </div>
          <div class="bg-gray-800 rounded-lg p-4">
            <div class="text-sm text-gray-400">Tokens Used</div>
            <div class="text-3xl font-bold">{state.metrics.tokensIn + state.metrics.tokensOut}</div>
          </div>
        </div>

        <h2 class="text-xl font-semibold mb-4">Running Agents</h2>
        {state.running.length === 0
          ? <p class="text-gray-500">No agents running</p>
          : <div class="space-y-2">
              {state.running.map((r) => (
                <div class="bg-gray-800 rounded-lg p-4 flex justify-between items-center">
                  <div>
                    <a href={`/issues/${r.issueKey.replace("#", "/")}`} class="text-blue-400 hover:underline">{r.issueKey}</a>
                    <span class="ml-2 text-gray-500 text-sm">{r.provider}</span>
                  </div>
                  <span class="text-green-400 text-sm">running</span>
                </div>
              ))}
            </div>
        }

        <div class="mt-6">
          <button
            onclick="fetch('/api/v1/refresh', {method:'POST'}).then(()=>location.reload())"
            class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm"
          >
            Force Refresh
          </button>
        </div>
      </Layout>
    );
  });

  return route;
}
```

**Step 3: Implement sprint board page**

```tsx
// src/web/routes/sprint.tsx
import { Hono } from "hono";
import { Layout } from "../components/layout.js";

export interface SprintContext {
  getBoard: () => Promise<{
    todo: Array<{ key: string; title: string }>;
    inProgress: Array<{ key: string; title: string }>;
    inReview: Array<{ key: string; title: string }>;
    done: Array<{ key: string; title: string }>;
  }>;
}

export function sprintRoute(ctx: SprintContext): Hono {
  const route = new Hono();

  route.get("/", async (c) => {
    const board = await ctx.getBoard();
    const columns = [
      { name: "Todo", items: board.todo, color: "gray" },
      { name: "In Progress", items: board.inProgress, color: "blue" },
      { name: "In Review", items: board.inReview, color: "yellow" },
      { name: "Done", items: board.done, color: "green" },
    ];

    return c.html(
      <Layout title="Sprint Board">
        <div class="grid grid-cols-4 gap-4">
          {columns.map((col) => (
            <div>
              <h3 class="font-semibold mb-3 text-gray-400">{col.name} ({col.items.length})</h3>
              <div class="space-y-2">
                {col.items.map((item) => (
                  <div class="bg-gray-800 rounded p-3 text-sm">
                    <div class="font-medium">{item.title}</div>
                    <div class="text-gray-500 text-xs mt-1">{item.key}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Layout>
    );
  });

  return route;
}
```

**Step 4: Implement issue detail and settings pages**

```tsx
// src/web/routes/issues.tsx
import { Hono } from "hono";
import { Layout } from "../components/layout.js";

export interface IssuesContext {
  getRunEvents: (issueKey: string) => Array<{ type: string; payload: Record<string, unknown>; ts: string }>;
  getRunHistory: (issueKey: string) => Array<{ id: string; status: string; startedAt: string; provider: string }>;
}

export function issuesRoute(ctx: IssuesContext): Hono {
  const route = new Hono();

  route.get("/:owner/:repo/:id", (c) => {
    const { owner, repo, id } = c.req.param();
    const issueKey = `${owner}/${repo}#${id}`;
    const events = ctx.getRunEvents(issueKey);
    const history = ctx.getRunHistory(issueKey);

    return c.html(
      <Layout title={issueKey}>
        <h1 class="text-2xl font-bold mb-4">{issueKey}</h1>

        <h2 class="text-lg font-semibold mb-2">Run History</h2>
        <div class="space-y-2 mb-6">
          {history.map((run) => (
            <div class="bg-gray-800 rounded p-3 flex justify-between text-sm">
              <span>{run.id}</span>
              <span>{run.provider}</span>
              <span class={run.status === "completed" ? "text-green-400" : "text-red-400"}>{run.status}</span>
              <span class="text-gray-500">{run.startedAt}</span>
            </div>
          ))}
        </div>

        <h2 class="text-lg font-semibold mb-2">Agent Output</h2>
        <div class="bg-black rounded p-4 font-mono text-xs max-h-96 overflow-y-auto" id="output">
          {events
            .filter((e) => e.type === "text")
            .map((e) => <div>{String((e.payload as any).text ?? "")}</div>)}
        </div>
      </Layout>
    );
  });

  return route;
}
```

```tsx
// src/web/routes/settings.tsx
import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import type { Config } from "../../config/schema.js";

export function settingsRoute(getConfig: () => Config): Hono {
  const route = new Hono();

  route.get("/", (c) => {
    const config = getConfig();
    return c.html(
      <Layout title="Settings">
        <h1 class="text-2xl font-bold mb-4">Settings</h1>
        <pre class="bg-gray-800 rounded p-4 text-sm overflow-x-auto">
          {JSON.stringify(config, null, 2)}
        </pre>
      </Layout>
    );
  });

  return route;
}
```

**Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/web/ && git commit -m "feat: add dashboard, sprint board, issue detail, and settings pages"
```

---

### Task 17: Web App — Planning UI (WebSocket)

**Files:**
- Create: `src/web/routes/planning.tsx`

**Step 1: Implement planning routes**

```tsx
// src/web/routes/planning.tsx
import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import type { PlanningRepo, PlanningSessionRow } from "../../db/planning.js";

export interface PlanningContext {
  planningRepo: PlanningRepo;
  onChat: (sessionId: string, message: string) => AsyncGenerator<string>;
}

export function planningRoute(ctx: PlanningContext): Hono {
  const route = new Hono();

  route.get("/", (c) => {
    const sessions = ctx.planningRepo.list();
    return c.html(
      <Layout title="Planning">
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-2xl font-bold">Planning Sessions</h1>
          <form method="POST" action="/planning/new">
            <button class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm">New Session</button>
          </form>
        </div>
        <div class="space-y-2">
          {sessions.map((s: PlanningSessionRow) => (
            <a href={`/planning/${s.id}`} class="block bg-gray-800 rounded p-4 hover:bg-gray-700">
              <div class="font-medium">{s.id}</div>
              <div class="text-gray-500 text-sm">{s.issueKey ?? "No issue"} — {s.updatedAt}</div>
            </a>
          ))}
        </div>
      </Layout>
    );
  });

  route.post("/new", (c) => {
    const id = crypto.randomUUID();
    ctx.planningRepo.save(id, []);
    return c.redirect(`/planning/${id}`);
  });

  route.get("/:id", (c) => {
    const id = c.req.param("id");
    const history = ctx.planningRepo.load(id);
    return c.html(
      <Layout title={`Planning: ${id}`}>
        <h1 class="text-xl font-bold mb-4">Planning Session</h1>
        <div id="chat" class="bg-gray-800 rounded p-4 max-h-96 overflow-y-auto mb-4 space-y-3">
          {history.map((msg) => (
            <div class={msg.role === "user" ? "text-blue-300" : "text-gray-300"}>
              <span class="font-semibold">{msg.role}:</span> {msg.content}
            </div>
          ))}
        </div>
        <form id="chat-form" class="flex gap-2">
          <input
            type="text"
            name="message"
            placeholder="Type a message..."
            class="flex-1 bg-gray-700 rounded px-4 py-2 text-sm"
            autocomplete="off"
          />
          <button type="submit" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm">Send</button>
        </form>
        <script dangerouslySetInnerHTML={{ __html: `
          const ws = new WebSocket(location.origin.replace('http','ws') + '/planning/${id}/ws');
          const chat = document.getElementById('chat');
          const form = document.getElementById('chat-form');
          ws.onmessage = (e) => {
            const div = document.createElement('div');
            div.className = 'text-gray-300';
            div.innerHTML = '<span class="font-semibold">assistant:</span> ' + e.data;
            chat.appendChild(div);
            chat.scrollTop = chat.scrollHeight;
          };
          form.onsubmit = (e) => {
            e.preventDefault();
            const input = form.message;
            const div = document.createElement('div');
            div.className = 'text-blue-300';
            div.innerHTML = '<span class="font-semibold">user:</span> ' + input.value;
            chat.appendChild(div);
            ws.send(input.value);
            input.value = '';
          };
        `}} />
      </Layout>
    );
  });

  return route;
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/web/routes/planning.tsx && git commit -m "feat: add planning session UI with WebSocket chat"
```

---

### Task 18: CLI Entry Point

**Files:**
- Modify: `src/index.ts`

**Step 1: Implement CLI with commander**

```typescript
// src/index.ts
#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadConfigFromString } from "./config/loader.js";
import { DEFAULT_CONFIG_PATH } from "./config/defaults.js";
import { createDatabase } from "./db/index.js";
import { RunsRepo } from "./db/runs.js";
import { RunEventsRepo } from "./db/run-events.js";
import { MetricsRepo } from "./db/metrics.js";
import { PlanningRepo } from "./db/planning.js";
import { GitHubClient } from "./github/client.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { WorkspaceManager } from "./workspace/manager.js";
import { SSEHub } from "./web/sse.js";
import { createApp } from "./web/app.js";
import { serve } from "@hono/node-server";
import pino from "pino";

const program = new Command();
program.name("oneagent").description("AI agent orchestrator for GitHub issues").version("0.1.0");

program
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .option("-p, --port <number>", "dashboard port")
  .option("--dry-run", "list eligible issues without dispatching")
  .option("--debug", "enable debug logging")
  .option("--log <path>", "log file path")
  .action(async (opts) => {
    const logger = pino({
      level: opts.debug ? "debug" : "info",
      ...(opts.log ? { transport: { target: "pino/file", options: { destination: opts.log } } } : {}),
    });

    if (!existsSync(opts.config)) {
      logger.error(`Config file not found: ${opts.config}`);
      process.exit(1);
    }

    const configYaml = readFileSync(opts.config, "utf-8");
    const config = loadConfigFromString(configYaml);

    if (opts.port) config.web.port = parseInt(opts.port, 10);

    const token = config.github.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      logger.error("No GitHub token found. Set GITHUB_TOKEN or configure github.token in config.");
      process.exit(1);
    }

    const db = createDatabase("oneagent.db");
    const runsRepo = new RunsRepo(db);
    const eventsRepo = new RunEventsRepo(db);
    const metricsRepo = new MetricsRepo(db);
    const planningRepo = new PlanningRepo(db);
    const github = new GitHubClient(token);
    const workspace = new WorkspaceManager(config.workspace.baseDir);
    const sseHub = new SSEHub();

    const orchestrator = new Orchestrator(config, github);

    if (opts.dryRun) {
      logger.info("Dry run — fetching eligible issues...");
      await orchestrator.tick();
      process.exit(0);
    }

    if (config.web.enabled) {
      const app = createApp({
        sseHub,
        onRefresh: () => orchestrator.tick(),
        getState: () => ({
          running: [...orchestrator.state.running()].map(([, e]) => ({
            runId: e.runId,
            issueKey: e.issueKey,
            provider: e.provider,
          })),
          retryQueue: [],
          metrics: metricsRepo.totals(),
        }),
      });

      serve({ fetch: app.fetch, port: config.web.port }, (info) => {
        logger.info(`Dashboard running at http://localhost:${info.port}`);
      });
    }

    orchestrator.start();
    logger.info("Orchestrator started");

    const shutdown = () => {
      logger.info("Shutting down...");
      orchestrator.stop();
      db.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program
  .command("init")
  .description("create default config file")
  .action(() => {
    if (existsSync(DEFAULT_CONFIG_PATH)) {
      console.error(`${DEFAULT_CONFIG_PATH} already exists`);
      process.exit(1);
    }
    writeFileSync(DEFAULT_CONFIG_PATH, `github:
  repos:
    - owner: your-org
      repo: your-repo
      labels: [oneagent]

agent:
  provider: claude-code

web:
  port: 3000
`);
    console.log(`Created ${DEFAULT_CONFIG_PATH}`);
  });

program
  .command("setup")
  .description("create required GitHub labels on configured repos")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .action(async (opts) => {
    const configYaml = readFileSync(opts.config, "utf-8");
    const config = loadConfigFromString(configYaml);
    const token = config.github.token ?? process.env.GITHUB_TOKEN;
    if (!token) { console.error("No GitHub token"); process.exit(1); }
    const github = new GitHubClient(token);
    for (const repo of config.github.repos) {
      for (const label of [config.labels.eligible, config.labels.inProgress, config.labels.failed]) {
        try {
          await github.addLabel(repo.owner, repo.repo, 0, label);
          console.log(`Created label "${label}" on ${repo.owner}/${repo.repo}`);
        } catch {
          console.log(`Label "${label}" may already exist on ${repo.owner}/${repo.repo}`);
        }
      }
    }
  });

program.parse();
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/index.ts && git commit -m "feat: add CLI entry point with commander"
```

---

### Task 19: Integration — Wire Agent Execution into Dispatcher

**Files:**
- Modify: `src/orchestrator/orchestrator.ts`
- Modify: `src/orchestrator/dispatcher.ts`
- Create: `src/orchestrator/pr-monitor.ts`

**Step 1: Extend Dispatcher to execute agent runs**

Update `src/orchestrator/dispatcher.ts` to import one-agent-sdk's `run` and wire it with the agent graph, middleware stack, and abort signal. The `dispatch` method should:

1. Call `run(prompt, { agent: "coder", agents: agentMap, provider, signal })`
2. Iterate the returned `stream` AsyncGenerator
3. For each `StreamChunk`: update `lastActivity`, bridge to SSE + SQLite via `bridgeChunkToSSE`
4. On stream end: mark run completed in state + SQLite
5. On error: mark failed, enqueue retry if eligible, label issue `oneagent-failed` if exhausted

**Step 2: Implement PR monitor**

```typescript
// src/orchestrator/pr-monitor.ts
import type { Config } from "../config/schema.js";
import type { GitHubClient } from "../github/client.js";
import { Dispatcher } from "./dispatcher.js";

export class PRMonitor {
  private timer?: ReturnType<typeof setInterval>;
  private dispatcher = new Dispatcher();

  constructor(
    private config: Config,
    private github: GitHubClient,
  ) {}

  start(intervalMs: number): void {
    this.timer = setInterval(() => this.check(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(): Promise<void> {
    for (const repo of this.config.github.repos) {
      const prs = await this.github.fetchPRsWithLabel(repo.owner, repo.repo, this.config.labels.inProgress);
      for (const pr of prs) {
        const checks = await this.github.fetchCheckRuns(pr.owner, pr.repo, pr.headRef);
        const failed = checks.filter((c) => c.conclusion === "failure");
        if (failed.length > 0) {
          const failureLog = failed.map((c) => `${c.name}: ${c.conclusion}`).join("\n");
          const prompt = this.dispatcher.buildPRFixPrompt(pr, failureLog);
          // Dispatch PR workflow agent with this prompt
          // (wired in integration — same run() pattern as issue dispatch)
        }
      }
    }
  }
}
```

**Step 3: Wire PR monitor into Orchestrator.start()**

Add `this.prMonitor.start(this.config.poll.interval * 2)` to the orchestrator's `start()` method.

**Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/orchestrator/ && git commit -m "feat: wire agent execution and PR monitoring into orchestrator"
```

---

### Task 20: Config Hot Reload

**Files:**
- Create: `src/config/watcher.ts`
- Test: `src/config/__tests__/watcher.test.ts`

**Step 1: Write failing test**

```typescript
// src/config/__tests__/watcher.test.ts
import { describe, it, expect, vi } from "vitest";
import { ConfigWatcher } from "../watcher.js";

describe("ConfigWatcher", () => {
  it("calls onChange when config string changes", () => {
    const onChange = vi.fn();
    const watcher = new ConfigWatcher(onChange);
    watcher.handleFileChange("github:\n  repos:\n    - owner: a\n      repo: b\n      labels: [x]");
    expect(onChange).toHaveBeenCalled();
  });

  it("does not call onChange if parse fails", () => {
    const onChange = vi.fn();
    const watcher = new ConfigWatcher(onChange);
    watcher.handleFileChange("invalid: [[[");
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/__tests__/watcher.test.ts`
Expected: FAIL

**Step 3: Implement ConfigWatcher**

```typescript
// src/config/watcher.ts
import { loadConfigFromString } from "./loader.js";
import type { Config } from "./schema.js";

export class ConfigWatcher {
  constructor(private onChange: (config: Config) => void) {}

  handleFileChange(yamlContent: string): void {
    try {
      const config = loadConfigFromString(yamlContent);
      this.onChange(config);
    } catch {
      // Invalid config — keep previous
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/config/__tests__/watcher.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/watcher.ts src/config/__tests__/watcher.test.ts && git commit -m "feat: add config hot reload watcher"
```

---

### Task 21: Tools — GitHub, Planning, Workspace (defineTool)

**Files:**
- Create: `src/tools/github.ts`
- Create: `src/tools/planning.ts`
- Create: `src/tools/workspace.ts`
- Create: `src/tools/index.ts`

**Step 1: Implement GitHub tools**

```typescript
// src/tools/github.ts
import { defineTool } from "one-agent-sdk";
import { z } from "zod";

export const readIssueTool = defineTool({
  name: "github_read_issue",
  description: "Read a GitHub issue's title, body, and comments",
  parameters: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.number(),
  }),
  handler: async ({ owner, repo, number }) => {
    // Delegates to gh CLI or octokit at runtime
    const { execSync } = await import("node:child_process");
    const result = execSync(`gh issue view ${number} --repo ${owner}/${repo} --json title,body,comments`, { encoding: "utf-8" });
    return result;
  },
});

export const createPRTool = defineTool({
  name: "github_create_pr",
  description: "Create a pull request",
  parameters: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    body: z.string(),
    head: z.string(),
    base: z.string().default("main"),
  }),
  handler: async ({ owner, repo, title, body, head, base }) => {
    const { execSync } = await import("node:child_process");
    const result = execSync(
      `gh pr create --repo ${owner}/${repo} --title "${title}" --body "${body}" --head ${head} --base ${base}`,
      { encoding: "utf-8" },
    );
    return result;
  },
});
```

**Step 2: Implement planning tools**

```typescript
// src/tools/planning.ts
import { defineTool } from "one-agent-sdk";
import { z } from "zod";

export const createPlanTool = defineTool({
  name: "create_plan",
  description: "Create a structured implementation plan from requirements",
  parameters: z.object({
    title: z.string(),
    phases: z.array(z.object({
      name: z.string(),
      tasks: z.array(z.object({
        description: z.string(),
        complexity: z.enum(["low", "medium", "high"]),
      })),
    })),
  }),
  handler: async ({ title, phases }) => {
    const plan = phases.map((p) =>
      `## ${p.name}\n${p.tasks.map((t) => `- [${t.complexity}] ${t.description}`).join("\n")}`
    ).join("\n\n");
    return `# ${title}\n\n${plan}`;
  },
});

export const refinePlanTool = defineTool({
  name: "refine_plan",
  description: "Refine an existing plan based on feedback",
  parameters: z.object({
    currentPlan: z.string(),
    feedback: z.string(),
  }),
  handler: async ({ currentPlan, feedback }) => {
    return `Plan to refine:\n${currentPlan}\n\nFeedback:\n${feedback}`;
  },
});
```

**Step 3: Implement workspace tools**

```typescript
// src/tools/workspace.ts
import { defineTool } from "one-agent-sdk";
import { z } from "zod";

export const setupWorkspaceTool = defineTool({
  name: "workspace_setup",
  description: "Set up a workspace directory for an issue",
  parameters: z.object({
    issueKey: z.string(),
    baseDir: z.string(),
  }),
  handler: async ({ issueKey, baseDir }) => {
    const { mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dirName = issueKey.replace(/[/#]/g, "-");
    const dir = join(baseDir, dirName);
    mkdirSync(dir, { recursive: true });
    return `Workspace created at ${dir}`;
  },
});
```

```typescript
// src/tools/index.ts
export { readIssueTool, createPRTool } from "./github.js";
export { createPlanTool, refinePlanTool } from "./planning.js";
export { setupWorkspaceTool } from "./workspace.js";
```

**Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/tools/ && git commit -m "feat: add agent tools for GitHub, planning, and workspace management"
```

---

### Task 22: Full Integration & Smoke Test

**Files:**
- Modify: `src/index.ts` — wire all routes (dashboard, sprint, issues, settings, planning) into Hono app
- Create: `src/web/routes/index.ts` — export all route builders

**Step 1: Create route index**

```typescript
// src/web/routes/index.ts
export { apiRoutes, type AppContext } from "./api.js";
export { dashboardRoute } from "./dashboard.js";
export { sprintRoute, type SprintContext } from "./sprint.js";
export { issuesRoute, type IssuesContext } from "./issues.js";
export { settingsRoute } from "./settings.js";
export { planningRoute, type PlanningContext } from "./planning.js";
```

**Step 2: Update createApp to mount all routes**

Update `src/web/app.ts` to accept the full context and mount dashboard at `/`, sprint at `/sprint`, issues at `/issues`, settings at `/settings`, planning at `/planning`.

**Step 3: Verify full build**

Run: `npx tsc`
Expected: No errors, dist/ output created

**Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add -A && git commit -m "feat: wire all routes and complete integration"
```

---

### Task 23: Default Config File & README

**Files:**
- Create: `oneagent.example.yaml`
- Create: `README.md`

**Step 1: Create example config**

```yaml
# oneagent.example.yaml
github:
  # token: ${GITHUB_TOKEN}  # or set GITHUB_TOKEN env var
  repos:
    - owner: your-org
      repo: your-repo
      labels: [oneagent]

agent:
  provider: claude-code  # claude-code | codex | kimi-cli
  stallTimeout: 300000
  maxRetries: 3

concurrency:
  max: 3

poll:
  interval: 30000

web:
  port: 3000
  enabled: true
```

**Step 2: Create README**

Write a README covering: what it is, quick start, config reference, agent architecture, and dashboard.

**Step 3: Commit**

```bash
git add oneagent.example.yaml README.md && git commit -m "docs: add example config and README"
```
