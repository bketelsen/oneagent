import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function detectTestCommand(cwd: string): { cmd: string; args: string[] } {
  const pkgPath = join(cwd, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      if (pkg.scripts?.test) return { cmd: "npm", args: ["test"] };
    } catch {
      // invalid JSON, fall through
    }
  }
  const makefilePath = join(cwd, "Makefile");
  if (existsSync(makefilePath)) {
    const makefile = readFileSync(makefilePath, "utf-8");
    if (/^test:/m.test(makefile)) return { cmd: "make", args: ["test"] };
  }
  return { cmd: "npm", args: ["test"] };
}

export const runTestsTool = defineTool({
  name: "run_tests",
  description: "Run the project's test suite. Auto-detects test command from package.json or Makefile.",
  parameters: z.object({
    cwd: z.string().describe("Working directory for the project"),
  }),
  handler: async ({ cwd }) => {
    const { cmd, args } = detectTestCommand(cwd);
    try {
      const output = execSync([cmd, ...args].join(" "), { cwd, encoding: "utf-8", timeout: 120000, stdio: "pipe" });
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
    try {
      const output = execSync(args.join(" "), { cwd, encoding: "utf-8", timeout: 120000, stdio: "pipe" });
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
