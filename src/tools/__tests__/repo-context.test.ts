import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { discoverInstructionFiles, discoverCustomSkills, discoverRepoContext } from "../repo-context.js";

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

describe("discoverCustomSkills", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "repo-ctx-skills-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("discovers a valid skill file", () => {
    mkdirSync(join(tempDir, ".oneagent", "skills"), { recursive: true });
    writeFileSync(
      join(tempDir, ".oneagent", "skills", "django.md"),
      "---\nname: Django\ndescription: Django web framework skill\n---\nUse Django best practices.",
    );
    const result = discoverCustomSkills(tempDir);
    expect(result).toContain("## Custom Skill: Django");
    expect(result).toContain("Django web framework skill");
    expect(result).toContain("Use Django best practices.");
  });

  it("discovers multiple skill files", () => {
    mkdirSync(join(tempDir, ".oneagent", "skills"), { recursive: true });
    writeFileSync(
      join(tempDir, ".oneagent", "skills", "django.md"),
      "---\nname: Django\ndescription: Django skill\n---\nDjango body.",
    );
    writeFileSync(
      join(tempDir, ".oneagent", "skills", "react.md"),
      "---\nname: React\ndescription: React skill\n---\nReact body.",
    );
    const result = discoverCustomSkills(tempDir);
    expect(result).toContain("## Custom Skill: Django");
    expect(result).toContain("## Custom Skill: React");
  });

  it("skips files without required frontmatter", () => {
    mkdirSync(join(tempDir, ".oneagent", "skills"), { recursive: true });
    writeFileSync(
      join(tempDir, ".oneagent", "skills", "incomplete.md"),
      "---\nname: Incomplete\n---\nNo description field.",
    );
    const result = discoverCustomSkills(tempDir);
    expect(result).toBe("");
  });

  it("skips non-markdown files", () => {
    mkdirSync(join(tempDir, ".oneagent", "skills"), { recursive: true });
    writeFileSync(
      join(tempDir, ".oneagent", "skills", "notes.txt"),
      "---\nname: Notes\ndescription: Some notes\n---\nBody text.",
    );
    const result = discoverCustomSkills(tempDir);
    expect(result).toBe("");
  });

  it("returns empty string when .oneagent/skills does not exist", () => {
    const result = discoverCustomSkills(tempDir);
    expect(result).toBe("");
  });
});

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
