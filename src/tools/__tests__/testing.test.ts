import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runTestsTool,
  runTestsFilteredTool,
  detectTestCommand,
} from "../testing.js";

describe("testing tools", () => {
  it("run_tests has the correct name", () => {
    expect(runTestsTool.name).toBe("run_tests");
  });

  it("run_tests_filtered has the correct name", () => {
    expect(runTestsFilteredTool.name).toBe("run_tests_filtered");
  });

  it("run_tests has cwd parameter", () => {
    const schema = runTestsTool.parameters;
    const result = schema.safeParse({ cwd: "/tmp/project" });
    expect(result.success).toBe(true);
  });

  it("run_tests rejects missing cwd", () => {
    const schema = runTestsTool.parameters;
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("run_tests_filtered accepts cwd only", () => {
    const schema = runTestsFilteredTool.parameters;
    const result = schema.safeParse({ cwd: "/tmp/project" });
    expect(result.success).toBe(true);
  });

  it("run_tests_filtered accepts file and pattern", () => {
    const schema = runTestsFilteredTool.parameters;
    const result = schema.safeParse({
      cwd: "/tmp/project",
      file: "src/foo.test.ts",
      pattern: "should work",
    });
    expect(result.success).toBe(true);
  });

  it("run_tests_filtered rejects missing cwd", () => {
    const schema = runTestsFilteredTool.parameters;
    const result = schema.safeParse({ file: "test.ts" });
    expect(result.success).toBe(false);
  });
});

describe("detectTestCommand", () => {
  let tempDir: string;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("returns npm test when package.json has a test script", () => {
    tempDir = mkdtempSync(join(tmpdir(), "detect-test-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
    );
    const result = detectTestCommand(tempDir);
    expect(result).toEqual({ cmd: "npm", args: ["test"] });
  });

  it("falls through when package.json exists but has no scripts.test", () => {
    tempDir = mkdtempSync(join(tmpdir(), "detect-test-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "my-pkg" }),
    );
    // No Makefile either, so should fall through to default
    const result = detectTestCommand(tempDir);
    expect(result).toEqual({ cmd: "npm", args: ["test"] });
  });

  it("falls through when package.json has scripts but no test key", () => {
    tempDir = mkdtempSync(join(tmpdir(), "detect-test-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc" } }),
    );
    const result = detectTestCommand(tempDir);
    expect(result).toEqual({ cmd: "npm", args: ["test"] });
  });

  it("returns make test when Makefile has a test target", () => {
    tempDir = mkdtempSync(join(tmpdir(), "detect-test-"));
    writeFileSync(
      join(tempDir, "Makefile"),
      "build:\n\tgo build\n\ntest:\n\tgo test ./...\n",
    );
    const result = detectTestCommand(tempDir);
    expect(result).toEqual({ cmd: "make", args: ["test"] });
  });

  it("prefers package.json over Makefile when both exist", () => {
    tempDir = mkdtempSync(join(tmpdir(), "detect-test-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ scripts: { test: "vitest" } }),
    );
    writeFileSync(join(tempDir, "Makefile"), "test:\n\tmake test\n");
    const result = detectTestCommand(tempDir);
    expect(result).toEqual({ cmd: "npm", args: ["test"] });
  });

  it("falls back to Makefile when package.json has no test script", () => {
    tempDir = mkdtempSync(join(tmpdir(), "detect-test-"));
    writeFileSync(
      join(tempDir, "package.json"),
      JSON.stringify({ scripts: { build: "tsc" } }),
    );
    writeFileSync(join(tempDir, "Makefile"), "test:\n\tgo test ./...\n");
    const result = detectTestCommand(tempDir);
    expect(result).toEqual({ cmd: "make", args: ["test"] });
  });

  it("returns default npm test when directory is empty", () => {
    tempDir = mkdtempSync(join(tmpdir(), "detect-test-"));
    const result = detectTestCommand(tempDir);
    expect(result).toEqual({ cmd: "npm", args: ["test"] });
  });

  it("handles malformed package.json gracefully", () => {
    tempDir = mkdtempSync(join(tmpdir(), "detect-test-"));
    writeFileSync(join(tempDir, "package.json"), "not valid json{{{");
    const result = detectTestCommand(tempDir);
    // Should fall through to default since parse fails
    expect(result).toEqual({ cmd: "npm", args: ["test"] });
  });

  it("ignores Makefile without a test target", () => {
    tempDir = mkdtempSync(join(tmpdir(), "detect-test-"));
    writeFileSync(
      join(tempDir, "Makefile"),
      "build:\n\tgo build\n\nclean:\n\trm -rf dist\n",
    );
    const result = detectTestCommand(tempDir);
    expect(result).toEqual({ cmd: "npm", args: ["test"] });
  });
});
