import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLogsTool, inspectErrorTool } from "../debugging.js";

describe("debugging tools", () => {
  // --- Parameter schema validation ---

  it("readLogsTool has correct name", () => {
    expect(readLogsTool.name).toBe("read_logs");
  });

  it("inspectErrorTool has correct name", () => {
    expect(inspectErrorTool.name).toBe("inspect_error");
  });

  it("readLogsTool rejects missing filePath", () => {
    const result = readLogsTool.parameters.safeParse({});
    expect(result.success).toBe(false);
  });

  it("readLogsTool accepts valid params with default lines", () => {
    const result = readLogsTool.parameters.safeParse({ filePath: "/tmp/test.log" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lines).toBe(100);
    }
  });

  it("inspectErrorTool rejects missing stackTrace", () => {
    const result = inspectErrorTool.parameters.safeParse({});
    expect(result.success).toBe(false);
  });

  it("inspectErrorTool accepts valid params with default contextLines", () => {
    const result = inspectErrorTool.parameters.safeParse({ stackTrace: "Error: boom" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.contextLines).toBe(5);
    }
  });

  // --- Handler behavior tests ---

  it("readLogsTool returns last N lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debug-test-"));
    try {
      const logFile = join(dir, "test.log");
      writeFileSync(logFile, "line1\nline2\nline3\nline4\nline5");
      const result = await readLogsTool.handler({ filePath: logFile, lines: 2 });
      expect(result).toBe("line4\nline5");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("readLogsTool returns all lines when fewer than N", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debug-test-"));
    try {
      const logFile = join(dir, "test.log");
      writeFileSync(logFile, "only\ntwo");
      const result = await readLogsTool.handler({ filePath: logFile, lines: 100 });
      expect(result).toBe("only\ntwo");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("readLogsTool handles missing file", async () => {
    const result = await readLogsTool.handler({ filePath: "/nonexistent/file.log", lines: 10 });
    expect(result).toContain("File not found");
  });

  it("inspectErrorTool returns 'no references' for non-matching input", async () => {
    const result = await inspectErrorTool.handler({ stackTrace: "no frames here", contextLines: 3 });
    expect(result).toContain("No source file references found");
  });

  it("inspectErrorTool extracts frames and shows source context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "debug-test-"));
    try {
      const srcFile = join(dir, "app.ts");
      writeFileSync(srcFile, "line1\nline2\nline3\nline4\nline5\nline6\nline7");

      const stackTrace = `Error: something broke
    at myFunction (${srcFile}:4:10)
    at Object.<anonymous> (${srcFile}:1:1)`;

      const result = await inspectErrorTool.handler({ stackTrace, contextLines: 1 });
      // Should contain references to both frames
      expect(result).toContain(`${srcFile}:4`);
      expect(result).toContain(`${srcFile}:1`);
      // The error line should be marked with >>
      expect(result).toContain(">> 4:");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("inspectErrorTool skips node_modules frames", async () => {
    const stackTrace = `Error: fail
    at something (/project/node_modules/lib/index.js:10:5)`;
    const result = await inspectErrorTool.handler({ stackTrace, contextLines: 3 });
    expect(result).toContain("No source file references found");
  });

  it("inspectErrorTool handles unreadable files gracefully", async () => {
    const stackTrace = `Error: fail
    at something (/nonexistent/path/file.ts:5:10)`;
    const result = await inspectErrorTool.handler({ stackTrace, contextLines: 3 });
    expect(result).toContain("file not readable");
  });
});
