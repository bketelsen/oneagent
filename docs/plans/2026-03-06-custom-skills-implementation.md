# Custom Agent Skills & Repo Context Discovery — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `discover_repo_context` tool that scans target repositories for instruction files (CLAUDE.md, AGENTS.md, copilot instructions, .cursorrules) and custom skills (`.oneagent/skills/*.md`), normalizes them, and injects the result into the coder agent's prompt.

**Architecture:** A new `defineTool()` reads the repo working directory, discovers instruction files and skill markdown files with frontmatter, and returns a single normalized string. The coder prompt is updated to tell the agent to call this tool first. Unit, integration, and functional tests verify all layers without LLM calls.

**Tech Stack:** TypeScript, Vitest, `one-agent-sdk` (`defineTool`), `zod` for schema, Node `fs` for file reading.

---

### Task 1: Frontmatter Parser Utility

**Files:**
- Create: `src/tools/parse-frontmatter.ts`
- Test: `src/tools/__tests__/parse-frontmatter.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/tools/__tests__/parse-frontmatter.test.ts
import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../parse-frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter and body", () => {
    const input = `---
name: my-skill
description: A test skill
---

Body content here.`;
    const result = parseFrontmatter(input);
    expect(result.attributes).toEqual({ name: "my-skill", description: "A test skill" });
    expect(result.body.trim()).toBe("Body content here.");
  });

  it("returns empty attributes when no frontmatter", () => {
    const input = "Just body content, no frontmatter.";
    const result = parseFrontmatter(input);
    expect(result.attributes).toEqual({});
    expect(result.body).toBe("Just body content, no frontmatter.");
  });

  it("handles empty body after frontmatter", () => {
    const input = `---
name: empty-body
description: Nothing below
---`;
    const result = parseFrontmatter(input);
    expect(result.attributes).toEqual({ name: "empty-body", description: "Nothing below" });
    expect(result.body.trim()).toBe("");
  });

  it("handles frontmatter with extra fields", () => {
    const input = `---
name: skill
description: desc
custom: value
---

Body.`;
    const result = parseFrontmatter(input);
    expect(result.attributes).toEqual({ name: "skill", description: "desc", custom: "value" });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/__tests__/parse-frontmatter.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/tools/parse-frontmatter.ts
import { parse as parseYaml } from "yaml";

export interface FrontmatterResult {
  attributes: Record<string, string>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { attributes: {}, body: content };
  }
  const attributes = parseYaml(match[1]) ?? {};
  return { attributes, body: match[2] };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/__tests__/parse-frontmatter.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/tools/parse-frontmatter.ts src/tools/__tests__/parse-frontmatter.test.ts
git commit -m "feat: add frontmatter parser utility for skill markdown files"
```

---

### Task 2: Instruction File Discovery

**Files:**
- Create: `src/tools/repo-context.ts`
- Test: `src/tools/__tests__/repo-context.test.ts`

This task implements only the instruction file discovery part (CLAUDE.md, AGENTS.md, etc). Skills come in Task 3.

**Step 1: Write the failing tests**

```typescript
// src/tools/__tests__/repo-context.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { discoverInstructionFiles } from "../repo-context.js";

describe("discoverInstructionFiles", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "repo-ctx-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("discovers CLAUDE.md at repo root", () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "Use pytest for testing.");
    const result = discoverInstructionFiles(tempDir);
    expect(result).toContain("## Repository Instructions (from CLAUDE.md)");
    expect(result).toContain("Use pytest for testing.");
  });

  it("discovers AGENTS.md at repo root", () => {
    writeFileSync(join(tempDir, "AGENTS.md"), "Prefer functional style.");
    const result = discoverInstructionFiles(tempDir);
    expect(result).toContain("## Repository Instructions (from AGENTS.md)");
    expect(result).toContain("Prefer functional style.");
  });

  it("discovers .github/copilot-instructions.md", () => {
    mkdirSync(join(tempDir, ".github"), { recursive: true });
    writeFileSync(join(tempDir, ".github", "copilot-instructions.md"), "Copilot rules.");
    const result = discoverInstructionFiles(tempDir);
    expect(result).toContain("## Repository Instructions (from .github/copilot-instructions.md)");
    expect(result).toContain("Copilot rules.");
  });

  it("discovers .cursorrules at repo root", () => {
    writeFileSync(join(tempDir, ".cursorrules"), "Cursor conventions.");
    const result = discoverInstructionFiles(tempDir);
    expect(result).toContain("## Repository Instructions (from .cursorrules)");
    expect(result).toContain("Cursor conventions.");
  });

  it("combines multiple instruction files", () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "Claude instructions.");
    writeFileSync(join(tempDir, "AGENTS.md"), "Agent instructions.");
    const result = discoverInstructionFiles(tempDir);
    expect(result).toContain("from CLAUDE.md");
    expect(result).toContain("from AGENTS.md");
  });

  it("returns empty string when no instruction files found", () => {
    const result = discoverInstructionFiles(tempDir);
    expect(result).toBe("");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/__tests__/repo-context.test.ts`
Expected: FAIL — cannot import `discoverInstructionFiles`

**Step 3: Write minimal implementation**

```typescript
// src/tools/repo-context.ts
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const INSTRUCTION_FILES = [
  { path: "CLAUDE.md", label: "CLAUDE.md" },
  { path: "AGENTS.md", label: "AGENTS.md" },
  { path: ".github/copilot-instructions.md", label: ".github/copilot-instructions.md" },
  { path: ".cursorrules", label: ".cursorrules" },
];

export function discoverInstructionFiles(workingDir: string): string {
  const sections: string[] = [];

  for (const file of INSTRUCTION_FILES) {
    const fullPath = join(workingDir, file.path);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, "utf-8");
      sections.push(`## Repository Instructions (from ${file.label})\n\n${content}`);
    }
  }

  return sections.join("\n\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/__tests__/repo-context.test.ts`
Expected: PASS (6 tests)

**Step 5: Commit**

```bash
git add src/tools/repo-context.ts src/tools/__tests__/repo-context.test.ts
git commit -m "feat: add instruction file discovery for target repos"
```

---

### Task 3: Custom Skills Loading

**Files:**
- Modify: `src/tools/repo-context.ts`
- Modify: `src/tools/__tests__/repo-context.test.ts`

**Step 1: Add failing tests for skills discovery**

Append to `src/tools/__tests__/repo-context.test.ts`:

```typescript
import { discoverInstructionFiles, discoverCustomSkills } from "../repo-context.js";

describe("discoverCustomSkills", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "repo-skills-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("discovers a valid skill file", () => {
    const skillsDir = join(tempDir, ".oneagent", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "django.md"), `---
name: django-expert
description: Django conventions
---

Use class-based views.`);
    const result = discoverCustomSkills(tempDir);
    expect(result).toContain("## Custom Skill: django-expert");
    expect(result).toContain("Django conventions");
    expect(result).toContain("Use class-based views.");
  });

  it("discovers multiple skill files", () => {
    const skillsDir = join(tempDir, ".oneagent", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "a.md"), `---
name: skill-a
description: First skill
---

Content A.`);
    writeFileSync(join(skillsDir, "b.md"), `---
name: skill-b
description: Second skill
---

Content B.`);
    const result = discoverCustomSkills(tempDir);
    expect(result).toContain("## Custom Skill: skill-a");
    expect(result).toContain("## Custom Skill: skill-b");
  });

  it("skips files without required frontmatter", () => {
    const skillsDir = join(tempDir, ".oneagent", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "bad.md"), `---
name: incomplete
---

Missing description.`);
    const result = discoverCustomSkills(tempDir);
    expect(result).toBe("");
  });

  it("skips non-markdown files", () => {
    const skillsDir = join(tempDir, ".oneagent", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "notes.txt"), "not a skill");
    const result = discoverCustomSkills(tempDir);
    expect(result).toBe("");
  });

  it("returns empty string when .oneagent/skills does not exist", () => {
    const result = discoverCustomSkills(tempDir);
    expect(result).toBe("");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/__tests__/repo-context.test.ts`
Expected: FAIL — `discoverCustomSkills` not exported

**Step 3: Add implementation to `src/tools/repo-context.ts`**

Add these imports and functions:

```typescript
import { readdirSync } from "node:fs";
import { parseFrontmatter } from "./parse-frontmatter.js";

const SKILLS_DIR = ".oneagent/skills";

export function discoverCustomSkills(workingDir: string): string {
  const skillsPath = join(workingDir, SKILLS_DIR);
  if (!existsSync(skillsPath)) return "";

  const files = readdirSync(skillsPath).filter((f) => f.endsWith(".md"));
  const sections: string[] = [];

  for (const file of files) {
    const content = readFileSync(join(skillsPath, file), "utf-8");
    const { attributes, body } = parseFrontmatter(content);

    if (!attributes.name || !attributes.description) continue;

    sections.push(
      `## Custom Skill: ${attributes.name}\n${attributes.description}\n\n${body.trim()}`
    );
  }

  return sections.join("\n\n");
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/__tests__/repo-context.test.ts`
Expected: PASS (all 11 tests)

**Step 5: Commit**

```bash
git add src/tools/repo-context.ts src/tools/__tests__/repo-context.test.ts
git commit -m "feat: add custom skills discovery from .oneagent/skills/"
```

---

### Task 4: The `discover_repo_context` Tool Definition

**Files:**
- Modify: `src/tools/repo-context.ts`
- Modify: `src/tools/__tests__/repo-context.test.ts`

**Step 1: Add failing test for the combined tool function**

Append to the test file:

```typescript
import { discoverRepoContext } from "../repo-context.js";

describe("discoverRepoContext", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "repo-full-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("combines instruction files and skills", () => {
    writeFileSync(join(tempDir, "CLAUDE.md"), "Claude stuff.");
    const skillsDir = join(tempDir, ".oneagent", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "test.md"), `---
name: test-skill
description: Test desc
---

Skill body.`);
    const result = discoverRepoContext(tempDir);
    expect(result).toContain("from CLAUDE.md");
    expect(result).toContain("Claude stuff.");
    expect(result).toContain("## Custom Skill: test-skill");
    expect(result).toContain("Skill body.");
  });

  it("returns message when nothing found", () => {
    const result = discoverRepoContext(tempDir);
    expect(result).toBe("No project-specific instructions or skills found.");
  });

  it("works with only instruction files", () => {
    writeFileSync(join(tempDir, "AGENTS.md"), "Agent rules.");
    const result = discoverRepoContext(tempDir);
    expect(result).toContain("from AGENTS.md");
    expect(result).not.toContain("Custom Skill");
  });

  it("works with only skills", () => {
    const skillsDir = join(tempDir, ".oneagent", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "only.md"), `---
name: only-skill
description: The only one
---

Only skill body.`);
    const result = discoverRepoContext(tempDir);
    expect(result).not.toContain("Repository Instructions");
    expect(result).toContain("## Custom Skill: only-skill");
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tools/__tests__/repo-context.test.ts`
Expected: FAIL — `discoverRepoContext` not exported

**Step 3: Add the combined function and the `defineTool` export**

Add to `src/tools/repo-context.ts`:

```typescript
import { defineTool } from "one-agent-sdk";
import { z } from "zod";

export function discoverRepoContext(workingDir: string): string {
  const instructions = discoverInstructionFiles(workingDir);
  const skills = discoverCustomSkills(workingDir);

  const parts = [instructions, skills].filter(Boolean);
  if (parts.length === 0) return "No project-specific instructions or skills found.";

  return parts.join("\n\n");
}

export const discoverRepoContextTool = defineTool({
  name: "discover_repo_context",
  description:
    "Scan the repository for project-specific instructions (CLAUDE.md, AGENTS.md, copilot instructions, .cursorrules) and custom skills (.oneagent/skills/*.md). Call this after entering the repository.",
  parameters: z.object({
    workingDir: z.string().describe("Absolute path to the repository root"),
  }),
  handler: async ({ workingDir }) => {
    return discoverRepoContext(workingDir);
  },
});
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/tools/__tests__/repo-context.test.ts`
Expected: PASS (all 15 tests)

**Step 5: Commit**

```bash
git add src/tools/repo-context.ts src/tools/__tests__/repo-context.test.ts
git commit -m "feat: add discover_repo_context tool definition"
```

---

### Task 5: Update Coder Prompt

**Files:**
- Modify: `src/agents/prompts.ts`

**Step 1: No new test needed — existing prompt tests are in `dispatcher.test.ts` and `graph.test.ts`**

This is a string change. We verify it in the functional test (Task 7).

**Step 2: Update `CODER_PROMPT` in `src/agents/prompts.ts`**

Add after line 1 (after the opening line), before "Your workflow:":

```
After entering the repository, call the "discover_repo_context" tool to load project-specific instructions and custom skills. Follow any discovered instructions throughout your work.
```

The full updated prompt becomes:

```typescript
export const CODER_PROMPT = `You are a skilled software engineer working on a GitHub issue.

After entering the repository, call the "discover_repo_context" tool to load project-specific instructions and custom skills. Follow any discovered instructions throughout your work.

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
```

**Step 3: Commit**

```bash
git add src/agents/prompts.ts
git commit -m "feat: update coder prompt to call discover_repo_context"
```

---

### Task 6: Register Tool in Agent Graph

**Files:**
- Modify: `src/agents/graph.ts` (or wherever tools are registered — check how existing tools are wired)

The tool needs to be available to agents. Check how `readIssueTool`, `createPRTool`, and `setupWorkspaceTool` are registered and follow the same pattern.

**Step 1: Find where tools are registered**

Look at how the orchestrator passes tools to `run()`. Search for `readIssueTool` usage.

**Step 2: Import and add the tool**

Add to the tool registration alongside existing tools:

```typescript
import { discoverRepoContextTool } from "../tools/repo-context.js";
```

Add `discoverRepoContextTool` to the tools array/list passed to the agent runner.

**Step 3: Run existing tests to ensure nothing breaks**

Run: `npx vitest run`
Expected: All existing tests still pass

**Step 4: Commit**

```bash
git add <modified files>
git commit -m "feat: register discover_repo_context tool in agent graph"
```

---

### Task 7: Functional Test

**Files:**
- Create: `src/tools/__tests__/repo-context.functional.test.ts`

This test verifies the full integration: fixture repo -> tool -> prompt assembly.

**Step 1: Write the functional test**

```typescript
// src/tools/__tests__/repo-context.functional.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverRepoContext } from "../repo-context.js";
import { CODER_PROMPT } from "../../agents/prompts.js";
import { buildAgentGraph } from "../../agents/graph.js";

describe("Functional: repo context steers agent behavior", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "func-repo-"));
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("coder prompt instructs agent to call discover_repo_context", () => {
    expect(CODER_PROMPT).toContain("discover_repo_context");
  });

  it("discovers and normalizes all instruction file types", () => {
    writeFileSync(join(repoDir, "CLAUDE.md"), "Always use pytest.");
    writeFileSync(join(repoDir, "AGENTS.md"), "Prefer functional style.");
    mkdirSync(join(repoDir, ".github"), { recursive: true });
    writeFileSync(join(repoDir, ".github", "copilot-instructions.md"), "Copilot says use ESLint.");
    writeFileSync(join(repoDir, ".cursorrules"), "Cursor prefers tabs.");

    const context = discoverRepoContext(repoDir);

    // All four sources discovered and labeled
    expect(context).toContain("## Repository Instructions (from CLAUDE.md)");
    expect(context).toContain("## Repository Instructions (from AGENTS.md)");
    expect(context).toContain("## Repository Instructions (from .github/copilot-instructions.md)");
    expect(context).toContain("## Repository Instructions (from .cursorrules)");

    // Actual content present
    expect(context).toContain("Always use pytest.");
    expect(context).toContain("Prefer functional style.");
    expect(context).toContain("Copilot says use ESLint.");
    expect(context).toContain("Cursor prefers tabs.");
  });

  it("custom skills steer agent with project-specific guidance", () => {
    const skillsDir = join(repoDir, ".oneagent", "skills");
    mkdirSync(skillsDir, { recursive: true });

    writeFileSync(join(skillsDir, "security.md"), `---
name: security-reviewer
description: Run npm audit before every PR
---

Before creating any pull request:
1. Run \`npm audit\` and fix critical vulnerabilities
2. Check for hardcoded secrets with \`grep -r "API_KEY" src/\`
3. Ensure no .env files are committed`);

    writeFileSync(join(skillsDir, "testing.md"), `---
name: testing-conventions
description: Project testing standards
---

Testing rules:
- Use vitest, not jest
- All tests in __tests__ directories
- Minimum 80% coverage on new code`);

    const context = discoverRepoContext(repoDir);

    // Skills discovered with correct format
    expect(context).toContain("## Custom Skill: security-reviewer");
    expect(context).toContain("Run npm audit before every PR");
    expect(context).toContain("npm audit");

    expect(context).toContain("## Custom Skill: testing-conventions");
    expect(context).toContain("Use vitest, not jest");
  });

  it("combined context includes both instructions and skills", () => {
    writeFileSync(join(repoDir, "CLAUDE.md"), "Project uses Django.");
    const skillsDir = join(repoDir, ".oneagent", "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "django.md"), `---
name: django-expert
description: Django project conventions
---

Always use class-based views.`);

    const context = discoverRepoContext(repoDir);

    // Both layers present
    expect(context).toContain("from CLAUDE.md");
    expect(context).toContain("Project uses Django.");
    expect(context).toContain("## Custom Skill: django-expert");
    expect(context).toContain("Always use class-based views.");

    // Simulates what the agent would see: coder prompt + discovered context
    const fullPrompt = `${CODER_PROMPT}\n\n${context}`;
    expect(fullPrompt).toContain("discover_repo_context");
    expect(fullPrompt).toContain("Project uses Django.");
    expect(fullPrompt).toContain("Always use class-based views.");
  });

  it("empty repo returns clean message", () => {
    const context = discoverRepoContext(repoDir);
    expect(context).toBe("No project-specific instructions or skills found.");
  });

  it("agent graph contains all required agents", () => {
    const graph = buildAgentGraph();
    // Verify the graph is intact — custom skills don't break existing agents
    expect(graph.has("coder")).toBe(true);
    expect(graph.has("tdd")).toBe(true);
    expect(graph.has("debugger")).toBe(true);
    expect(graph.has("reviewer")).toBe(true);
    expect(graph.has("pr-workflow")).toBe(true);
    expect(graph.has("planner")).toBe(true);
  });
});
```

**Step 2: Run the functional test**

Run: `npx vitest run src/tools/__tests__/repo-context.functional.test.ts`
Expected: PASS (all 6 tests)

**Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing + new)

**Step 4: Commit**

```bash
git add src/tools/__tests__/repo-context.functional.test.ts
git commit -m "test: add functional test for repo context discovery and agent steering"
```

---

### Task 8: Final Verification

**Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

**Step 2: Run TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Final commit (if any fixes needed)**

If compilation revealed issues, fix and commit.
