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

    expect(context).toContain("## Repository Instructions (from CLAUDE.md)");
    expect(context).toContain("## Repository Instructions (from AGENTS.md)");
    expect(context).toContain("## Repository Instructions (from .github/copilot-instructions.md)");
    expect(context).toContain("## Repository Instructions (from .cursorrules)");

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
    expect(graph.has("coder")).toBe(true);
    expect(graph.has("tdd")).toBe(true);
    expect(graph.has("debugger")).toBe(true);
    expect(graph.has("reviewer")).toBe(true);
    expect(graph.has("pr-workflow")).toBe(true);
    expect(graph.has("planner")).toBe(true);
  });
});
