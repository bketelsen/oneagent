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
