# Planner Repo Context Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give the planner agent full repository awareness by selecting a repo before session creation and injecting discovered context into its prompt.

**Architecture:** New migration adds `repo` and `repo_context` columns. Session creation shallow-clones the selected repo, runs `discoverRepoContext()` + directory listing, stores the result, and injects it into the planner prompt on every chat message. The planning route gets a repo dropdown and passes configured repos via context.

**Tech Stack:** TypeScript, Hono JSX, better-sqlite3, `discoverRepoContext` from `src/tools/repo-context.ts`

---

### Task 1: Database Migration — Add `repo` and `repo_context` Columns

**Files:**
- Modify: `src/db/migrations.ts:15-50` (add migration version 3)
- Test: `src/db/__tests__/migrations.test.ts`

**Step 1: Write the failing test**

Add a test to `src/db/__tests__/migrations.test.ts` that verifies migration 3 adds the columns:

```typescript
it("migration 3 adds repo and repo_context to planning_sessions", () => {
  const db = new Database(":memory:");
  runMigrations(db);
  const columns = db
    .prepare("PRAGMA table_info(planning_sessions)")
    .all()
    .map((c: any) => c.name as string);
  expect(columns).toContain("repo");
  expect(columns).toContain("repo_context");
  db.close();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/migrations.test.ts -t "migration 3"`
Expected: FAIL — columns don't exist yet

**Step 3: Write the migration**

Add to the `MIGRATIONS` array in `src/db/migrations.ts`:

```typescript
{
  version: 3,
  description: "Add repo and repo_context to planning_sessions",
  up(db) {
    const columns = db
      .prepare("PRAGMA table_info(planning_sessions)")
      .all()
      .map((c: any) => c.name as string);

    if (!columns.includes("repo")) {
      db.exec("ALTER TABLE planning_sessions ADD COLUMN repo TEXT NOT NULL DEFAULT ''");
    }
    if (!columns.includes("repo_context")) {
      db.exec("ALTER TABLE planning_sessions ADD COLUMN repo_context TEXT");
    }
  },
},
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/migrations.test.ts -t "migration 3"`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/migrations.ts src/db/__tests__/migrations.test.ts
git commit -m "feat: add migration for repo and repo_context columns"
```

---

### Task 2: PlanningRepo — Add `repo` and `repo_context` to save/list/load

**Files:**
- Modify: `src/db/planning.ts` (update `PlanningSessionRow`, `save`, `list`, add `saveContext`/`loadContext`)
- Test: `src/db/__tests__/planning.test.ts`

**Step 1: Write the failing tests**

Add to `src/db/__tests__/planning.test.ts`:

```typescript
it("saves and loads repo context", () => {
  repo.save("s1", [], undefined, "owner/repo");
  repo.saveContext("s1", "## CLAUDE.md\nUse vitest");
  const ctx = repo.loadContext("s1");
  expect(ctx).toBe("## CLAUDE.md\nUse vitest");
});

it("list includes repo field", () => {
  repo.save("s1", [], undefined, "owner/repo");
  const sessions = repo.list();
  expect(sessions[0].repo).toBe("owner/repo");
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db/__tests__/planning.test.ts -t "saves and loads repo context"`
Expected: FAIL — `saveContext`/`loadContext` don't exist, `repo` not in row

**Step 3: Update PlanningRepo**

In `src/db/planning.ts`:

1. Add `repo` to `PlanningSessionRow`:
```typescript
export interface PlanningSessionRow {
  id: string;
  issueKey: string | null;
  repo: string;
  status: string | null;
  createdAt: string;
  updatedAt: string;
}
```

2. Update `save()` to accept `repo` parameter:
```typescript
save(id: string, history: PlanningMessage[], issueKey?: string, repo?: string): void {
  const now = new Date().toISOString();
  this.db.prepare(`
    INSERT INTO planning_sessions (id, issue_key, repo, created_at, updated_at, history)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET history = ?, updated_at = ?
  `).run(id, issueKey ?? null, repo ?? "", now, now, JSON.stringify(history), JSON.stringify(history), now);
}
```

3. Update `list()` to include `repo`:
```typescript
list(): PlanningSessionRow[] {
  return (this.db.prepare(
    "SELECT id, issue_key, repo, status, created_at, updated_at FROM planning_sessions ORDER BY updated_at DESC"
  ).all() as any[]).map((r) => ({
    id: r.id,
    issueKey: r.issue_key,
    repo: r.repo ?? "",
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
```

4. Add `saveContext()` and `loadContext()`:
```typescript
saveContext(id: string, context: string): void {
  this.db.prepare("UPDATE planning_sessions SET repo_context = ? WHERE id = ?").run(context, id);
}

loadContext(id: string): string | null {
  const row = this.db.prepare("SELECT repo_context FROM planning_sessions WHERE id = ?").get(id) as any;
  return row?.repo_context ?? null;
}
```

**Step 4: Run all planning tests**

Run: `npx vitest run src/db/__tests__/planning.test.ts`
Expected: PASS (all tests including existing ones)

**Step 5: Commit**

```bash
git add src/db/planning.ts src/db/__tests__/planning.test.ts
git commit -m "feat: add repo and repo_context to PlanningRepo"
```

---

### Task 3: Repo Context Capture Utility

**Files:**
- Create: `src/tools/capture-repo-context.ts`
- Test: `src/tools/__tests__/capture-repo-context.test.ts`

**Step 1: Write the failing test**

Create `src/tools/__tests__/capture-repo-context.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureRepoContext } from "../capture-repo-context.js";

describe("captureRepoContext", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "capture-ctx-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("captures instruction files and directory listing", () => {
    writeFileSync(join(repoDir, "CLAUDE.md"), "Use TypeScript strict mode.");
    mkdirSync(join(repoDir, "src"), { recursive: true });
    writeFileSync(join(repoDir, "src", "index.ts"), "console.log('hi');");

    const result = captureRepoContext(repoDir);

    expect(result).toContain("Use TypeScript strict mode.");
    expect(result).toContain("## Directory Structure");
    expect(result).toContain("src/index.ts");
  });

  it("excludes .git, node_modules, dist from directory listing", () => {
    mkdirSync(join(repoDir, ".git"), { recursive: true });
    writeFileSync(join(repoDir, ".git", "HEAD"), "ref");
    mkdirSync(join(repoDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(repoDir, "node_modules", "pkg", "index.js"), "x");
    mkdirSync(join(repoDir, "dist"), { recursive: true });
    writeFileSync(join(repoDir, "dist", "out.js"), "x");
    writeFileSync(join(repoDir, "src.ts"), "real");

    const result = captureRepoContext(repoDir);

    expect(result).not.toContain(".git/HEAD");
    expect(result).not.toContain("node_modules");
    expect(result).not.toContain("dist/out.js");
    expect(result).toContain("src.ts");
  });

  it("caps directory listing at 500 entries", () => {
    for (let i = 0; i < 600; i++) {
      writeFileSync(join(repoDir, `file-${String(i).padStart(4, "0")}.txt`), "x");
    }

    const result = captureRepoContext(repoDir);
    const lines = result.split("\n").filter((l) => l.startsWith("- "));

    expect(lines.length).toBeLessThanOrEqual(500);
    expect(result).toContain("(truncated");
  });

  it("returns just directory listing when no instruction files exist", () => {
    writeFileSync(join(repoDir, "main.go"), "package main");

    const result = captureRepoContext(repoDir);

    expect(result).toContain("## Directory Structure");
    expect(result).toContain("main.go");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/__tests__/capture-repo-context.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement captureRepoContext**

Create `src/tools/capture-repo-context.ts`:

```typescript
import { execFileSync } from "node:child_process";
import { discoverRepoContext } from "./repo-context.js";

const EXCLUDED_DIRS = [".git", "node_modules", "dist", ".next", "__pycache__", ".venv", "vendor"];
const MAX_FILES = 500;

function listFiles(dir: string): string[] {
  const excludeArgs = EXCLUDED_DIRS.flatMap((d) => ["-not", "-path", `./${d}/*`, "-not", "-path", `./${d}`]);
  try {
    const output = execFileSync(
      "find", [".", "-type", "f", ...excludeArgs],
      { cwd: dir, encoding: "utf-8", timeout: 10000 },
    );
    return output.trim().split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, "")).sort();
  } catch {
    return [];
  }
}

export function captureRepoContext(repoDir: string): string {
  const sections: string[] = [];

  const instructions = discoverRepoContext(repoDir);
  if (instructions !== "No project-specific instructions or skills found.") {
    sections.push(instructions);
  }

  const files = listFiles(repoDir);
  const truncated = files.length > MAX_FILES;
  const listed = files.slice(0, MAX_FILES);

  let dirSection = "## Directory Structure\n\n";
  dirSection += listed.map((f) => `- ${f}`).join("\n");
  if (truncated) {
    dirSection += `\n\n_(truncated — showing ${MAX_FILES} of ${files.length} files)_`;
  }
  sections.push(dirSection);

  return sections.join("\n\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/__tests__/capture-repo-context.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/capture-repo-context.ts src/tools/__tests__/capture-repo-context.test.ts
git commit -m "feat: add captureRepoContext utility for planning sessions"
```

---

### Task 4: Clone + Capture on Session Creation

**Files:**
- Create: `src/tools/clone-and-capture.ts`
- Test: `src/tools/__tests__/clone-and-capture.test.ts`

**Step 1: Write the failing test**

Create `src/tools/__tests__/clone-and-capture.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { cloneAndCapture } from "../clone-and-capture.js";

// This is an integration-level test that actually clones a small public repo
// Skip in CI if needed
describe("cloneAndCapture", () => {
  it("clones a public repo and returns context", async () => {
    const result = await cloneAndCapture("octocat", "Hello-World");
    expect(result).toContain("## Directory Structure");
    expect(result).toContain("README");
  }, 30000);

  it("throws on non-existent repo", async () => {
    await expect(cloneAndCapture("octocat", "this-repo-does-not-exist-12345"))
      .rejects.toThrow();
  }, 30000);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tools/__tests__/clone-and-capture.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement cloneAndCapture**

Create `src/tools/clone-and-capture.ts`:

```typescript
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { captureRepoContext } from "./capture-repo-context.js";

export async function cloneAndCapture(
  owner: string,
  repo: string,
  token?: string,
): Promise<string> {
  const url = token
    ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  const tmpDir = mkdtempSync(join(tmpdir(), "oneagent-plan-"));
  try {
    execFileSync("git", ["clone", "--depth", "1", "--single-branch", url, tmpDir], {
      encoding: "utf-8",
      timeout: 60000,
      stdio: "pipe",
    });
    return captureRepoContext(tmpDir);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/__tests__/clone-and-capture.test.ts`
Expected: PASS (may be slow due to network — 30s timeout)

**Step 5: Commit**

```bash
git add src/tools/clone-and-capture.ts src/tools/__tests__/clone-and-capture.test.ts
git commit -m "feat: add cloneAndCapture for planning session creation"
```

---

### Task 5: Update Planning Route — Repo Selector UI and Async Creation

**Files:**
- Modify: `src/web/routes/planning.tsx` (add repo selector, update session list, make creation async)
- Modify: `src/web/routes/planning.tsx:5-8` (update `PlanningContext` interface)

**Step 1: Update `PlanningContext` to include repos and `onCreate`**

In `src/web/routes/planning.tsx`, update the interface:

```typescript
export interface PlanningContext {
  planningRepo: PlanningRepo;
  repos: Array<{ owner: string; repo: string }>;
  onChat: (sessionId: string, message: string) => AsyncGenerator<string>;
  onCreate: (sessionId: string, owner: string, repo: string) => Promise<void>;
}
```

**Step 2: Update the `/planning` GET route — repo selector form**

Replace the `<form method="post" action="/planning/new">` block:

```tsx
<form method="post" action="/planning/new" class="flex gap-2 items-center">
  <select name="repo" class="bg-gray-700 rounded px-3 py-2 text-sm">
    {ctx.repos.map((r) => (
      <option value={`${r.owner}/${r.repo}`}>{r.owner}/{r.repo}</option>
    ))}
  </select>
  <button class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm">
    Start Planning Session
  </button>
</form>
```

**Step 3: Update session list to show repo**

In the session list item, add the repo label:

```tsx
<a href={`/planning/${s.id}`} class="block bg-gray-800 rounded p-4 hover:bg-gray-700">
  <div class="flex justify-between items-center">
    <div class="font-medium">{s.id.slice(0, 8)}...</div>
    <div class="flex gap-2 items-center">
      {s.repo && (
        <span class="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">{s.repo}</span>
      )}
      {s.status && (
        <span class={`text-xs px-2 py-0.5 rounded ${
          s.status === "published" ? "bg-green-900 text-green-300" :
          s.status === "approved" ? "bg-blue-900 text-blue-300" :
          "bg-gray-700 text-gray-400"
        }`}>{s.status}</span>
      )}
    </div>
  </div>
  <div class="text-gray-500 text-sm">{s.issueKey ?? "No issue"} — {s.updatedAt}</div>
</a>
```

**Step 4: Update POST `/planning/new` to accept repo and call `onCreate`**

```typescript
route.post("/new", async (c) => {
  const body = await c.req.parseBody();
  const repoStr = (body.repo as string) || `${ctx.repos[0].owner}/${ctx.repos[0].repo}`;
  const [owner, repo] = repoStr.split("/");
  const id = crypto.randomUUID();
  ctx.planningRepo.save(id, [], undefined, repoStr);
  // Clone and capture context in background — don't block redirect
  ctx.onCreate(id, owner, repo).catch(() => {});
  return c.redirect(`/planning/${id}`);
});
```

**Step 5: Run the build to check for type errors**

Run: `npm run build`
Expected: Type errors in `src/index.ts` where `PlanningContext` is constructed (missing `repos` and `onCreate`). That's expected — we fix it in Task 7.

**Step 6: Commit**

```bash
git add src/web/routes/planning.tsx
git commit -m "feat: add repo selector and context support to planning route"
```

---

### Task 6: Update Planning Session Detail — Show Repo Name

**Files:**
- Modify: `src/web/routes/planning.tsx` (session detail page)

**Step 1: Update the `/:id` GET route to show which repo the session targets**

In the session detail page, load the session row and display the repo. Change the `<h1>`:

```tsx
route.get("/:id", (c) => {
  const id = c.req.param("id");
  const history = ctx.planningRepo.load(id);
  const plan = ctx.planningRepo.loadPlan(id);
  const sessions = ctx.planningRepo.list();
  const session = sessions.find((s) => s.id === id);
  return c.html(
    <Layout title={`Planning: ${id}`}>
      <h1 class="text-xl font-bold mb-1">Planning Session</h1>
      {session?.repo && (
        <p class="text-gray-400 text-sm mb-4">Repository: <span class="text-blue-300">{session.repo}</span></p>
      )}
      {/* ... rest unchanged ... */}
```

**Step 2: Commit**

```bash
git add src/web/routes/planning.tsx
git commit -m "feat: show target repo on planning session detail page"
```

---

### Task 7: Wire Everything Together in `src/index.ts`

**Files:**
- Modify: `src/index.ts:126-166` (planning context construction)

**Step 1: Add imports**

At the top of `src/index.ts`, add:

```typescript
import { cloneAndCapture } from "./tools/clone-and-capture.js";
```

**Step 2: Update the planning context in `createApp` call**

Replace the `planning:` block (lines ~126-166):

```typescript
planning: {
  planningRepo,
  repos: config.github.repos.map((r) => ({ owner: r.owner, repo: r.repo })),
  onCreate: async (sessionId: string, owner: string, repo: string) => {
    try {
      const githubToken = config.github.token ?? process.env.GITHUB_TOKEN;
      const context = await cloneAndCapture(owner, repo, githubToken);
      planningRepo.saveContext(sessionId, context);
      logger.info({ sessionId, repo: `${owner}/${repo}` }, "Captured repo context for planning session");
    } catch (err) {
      logger.error({ sessionId, err }, "Failed to capture repo context");
    }
  },
  onChat: async function* (sessionId: string, message: string) {
    // Determine which repo this session targets
    const sessions = planningRepo.list();
    const session = sessions.find((s) => s.id === sessionId);
    const repoStr = session?.repo || `${config.github.repos[0].owner}/${config.github.repos[0].repo}`;
    const [owner, repoName] = repoStr.split("/");
    const repoConfig = config.github.repos.find((r) => r.owner === owner && r.repo === repoName) ?? config.github.repos[0];

    const planningTools = createPlanningTools({
      planningRepo,
      repoConfig,
    });
    const agent = createPlannerAgent([
      planningTools.createPlan,
      planningTools.refinePlan,
      planningTools.publishPlan,
    ]);

    // Load history and repo context
    const history = planningRepo.load(sessionId);
    const historyText = history
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");
    const repoContext = planningRepo.loadContext(sessionId);

    // Build prompt with repo context injected
    let prompt = agent.prompt;
    if (repoContext) {
      prompt += `\n\n## Repository Context for ${repoStr}\n\n${repoContext}`;
    }
    prompt += `\n\nIMPORTANT: The current planning session ID is "${sessionId}". Always use this sessionId when calling create_plan, refine_plan, or publish_plan.`;
    if (historyText) {
      prompt += `\n\nConversation history:\n${historyText}`;
    }
    prompt += `\n\nUser: ${message}`;

    const agentRun = await run(prompt, {
      provider: config.agent.provider,
      agent: agent as any,
    });

    let fullResponse = "";
    for await (const chunk of agentRun.stream) {
      if (chunk.type === "text") {
        fullResponse += chunk.text;
        yield chunk.text;
      }
    }
  },
},
```

**Step 3: Build and verify**

Run: `npm run build`
Expected: PASS — no type errors

**Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire repo context capture into planning session creation"
```

---

### Task 8: Full Integration Test — Verify Build and Existing Tests Pass

**Files:**
- No new files

**Step 1: Run the full test suite**

Run: `npm test`
Expected: All existing tests pass. The new clone-and-capture test may be slow but should pass.

**Step 2: Build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 3: Final commit if any fixups needed**

If any tests or build issues came up, fix and commit with an appropriate message.
