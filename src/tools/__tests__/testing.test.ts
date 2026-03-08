import { describe, it, expect } from "vitest";
import { runTestsTool, runTestsFilteredTool } from "../testing.js";

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
