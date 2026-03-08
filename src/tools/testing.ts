import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function detectTestCommand(cwd: string): string {
  // Check package.json for a test script
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts?.test) {
        return "npm test";
      }
    } catch {
      // ignore parse errors
    }
  }

  // Check Makefile for a test target
  const makefilePath = join(cwd, "Makefile");
  if (existsSync(makefilePath)) {
    try {
      const makefile = readFileSync(makefilePath, "utf-8");
      if (/^test:/m.test(makefile)) {
        return "make test";
      }
    } catch {
      // ignore read errors
    }
  }

  // Default
  return "npm test";
}

export const runTestsTool = defineTool({
  name: "run_tests",
  description:
    "Run the project's test suite. Auto-detects test command from package.json or Makefile.",
  parameters: z.object({
    cwd: z.string().describe("Working directory for the project"),
  }),
  handler: async ({ cwd }) => {
    const cmd = detectTestCommand(cwd);
    try {
      const output = execSync(cmd, {
        cwd,
        encoding: "utf-8",
        timeout: 120_000,
        stdio: "pipe",
      });
      return JSON.stringify({ exitCode: 0, output });
    } catch (err: any) {
      return JSON.stringify({
        exitCode: err.status ?? 1,
        output: err.stdout ?? "",
        stderr: err.stderr ?? "",
      });
    }
  },
});

export const runTestsFilteredTool = defineTool({
  name: "run_tests_filtered",
  description: "Run specific tests by file path or name pattern",
  parameters: z.object({
    cwd: z.string().describe("Working directory for the project"),
    file: z.string().optional().describe("Test file path to run"),
    pattern: z.string().optional().describe("Test name pattern to match"),
  }),
  handler: async ({ cwd, file, pattern }) => {
    const args = ["npx", "vitest", "run"];
    if (file) args.push(file);
    if (pattern) args.push("-t", pattern);
    const cmd = args.join(" ");
    try {
      const output = execSync(cmd, {
        cwd,
        encoding: "utf-8",
        timeout: 120_000,
        stdio: "pipe",
      });
      return JSON.stringify({ exitCode: 0, output });
    } catch (err: any) {
      return JSON.stringify({
        exitCode: err.status ?? 1,
        output: err.stdout ?? "",
        stderr: err.stderr ?? "",
      });
    }
  },
});

export { detectTestCommand };
