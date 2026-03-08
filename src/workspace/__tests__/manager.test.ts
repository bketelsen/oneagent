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

  it("accepts hooks config in the constructor", () => {
    baseDir = mkdtempSync(join(tmpdir(), "ws-test-"));
    const hooks = { setup: "echo setup", teardown: "echo teardown" };
    const mgr = new WorkspaceManager(baseDir, undefined, hooks);
    // Should not throw
    expect(mgr).toBeDefined();
  });

  it("runs setup hook when ensure() creates a directory", () => {
    baseDir = mkdtempSync(join(tmpdir(), "ws-test-"));
    const hooks = { setup: "echo setup > setup.marker" };
    const mgr = new WorkspaceManager(baseDir, undefined, hooks);
    const dir = mgr.ensure("owner/repo#99");
    expect(existsSync(dir)).toBe(true);
    // The setup hook should have created a marker file in the workspace dir
    expect(existsSync(join(dir, "setup.marker"))).toBe(true);
  });

  it("runs teardown hook and removes directory on cleanup()", () => {
    baseDir = mkdtempSync(join(tmpdir(), "ws-test-"));
    const hooks = { setup: "echo setup", teardown: "echo teardown" };
    const mgr = new WorkspaceManager(baseDir, undefined, hooks);
    const dir = mgr.ensure("owner/repo#50");
    expect(existsSync(dir)).toBe(true);
    mgr.cleanup("owner/repo#50");
    expect(existsSync(dir)).toBe(false);
  });

  it("cleanup() works without a teardown hook configured", () => {
    baseDir = mkdtempSync(join(tmpdir(), "ws-test-"));
    const mgr = new WorkspaceManager(baseDir);
    const dir = mgr.ensure("owner/repo#77");
    expect(existsSync(dir)).toBe(true);
    mgr.cleanup("owner/repo#77");
    expect(existsSync(dir)).toBe(false);
  });

  it("cleanup() is a no-op when workspace was never created", () => {
    baseDir = mkdtempSync(join(tmpdir(), "ws-test-"));
    const mgr = new WorkspaceManager(baseDir, undefined, { teardown: "echo teardown" });
    // Should not throw even though ensure() was never called for this key
    expect(() => mgr.cleanup("owner/repo#never-created")).not.toThrow();
  });

  it("cleanup() is safe to call twice", () => {
    baseDir = mkdtempSync(join(tmpdir(), "ws-test-"));
    const mgr = new WorkspaceManager(baseDir, undefined, { teardown: "echo teardown" });
    mgr.ensure("owner/repo#double");
    mgr.cleanup("owner/repo#double");
    // Second call should be a no-op, not throw
    expect(() => mgr.cleanup("owner/repo#double")).not.toThrow();
  });
});
