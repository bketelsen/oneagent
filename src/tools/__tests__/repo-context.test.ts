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
