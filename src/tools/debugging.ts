import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import { readFile } from "node:fs/promises";

export const readLogsTool = defineTool({
  name: "read_logs",
  description: "Read the last N lines of a log file",
  parameters: z.object({
    filePath: z.string(),
    lines: z.number().default(100),
  }),
  handler: async ({ filePath, lines }) => {
    try {
      const content = await readFile(filePath, "utf-8");
      const allLines = content.split("\n");
      const lastLines = allLines.slice(-lines);
      return lastLines.join("\n");
    } catch {
      return `File not found: ${filePath}`;
    }
  },
});

export const inspectErrorTool = defineTool({
  name: "inspect_error",
  description: "Parse a stack trace and show source context around each frame",
  parameters: z.object({
    stackTrace: z.string(),
    contextLines: z.number().default(5),
  }),
  handler: async ({ stackTrace, contextLines }) => {
    const frameRegex = /at\s+.*?\(?(\/[^:)]+):(\d+):\d+\)?/g;
    const frames: { file: string; line: number }[] = [];

    let match: RegExpExecArray | null;
    while ((match = frameRegex.exec(stackTrace)) !== null) {
      const file = match[1];
      const line = parseInt(match[2], 10);
      if (!file.includes("node_modules")) {
        frames.push({ file, line });
      }
    }

    if (frames.length === 0) {
      return "No source file references found in stack trace";
    }

    const sections: string[] = [];

    for (const frame of frames) {
      try {
        const content = await readFile(frame.file, "utf-8");
        const lines = content.split("\n");
        const start = Math.max(0, frame.line - 1 - contextLines);
        const end = Math.min(lines.length, frame.line + contextLines);
        const snippet = lines.slice(start, end).map((l, i) => {
          const lineNum = start + i + 1;
          const prefix = lineNum === frame.line ? ">>" : "  ";
          return `${prefix} ${lineNum}: ${l}`;
        });
        sections.push(`--- ${frame.file}:${frame.line} ---\n${snippet.join("\n")}`);
      } catch {
        sections.push(`--- ${frame.file}:${frame.line} ---\n(file not readable)`);
      }
    }

    return sections.join("\n\n");
  },
});
