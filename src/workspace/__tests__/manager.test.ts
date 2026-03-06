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
