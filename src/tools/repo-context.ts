import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const INSTRUCTION_FILES = [
  { path: "CLAUDE.md", label: "CLAUDE.md" },
  { path: "AGENTS.md", label: "AGENTS.md" },
  { path: ".github/copilot-instructions.md", label: ".github/copilot-instructions.md" },
  { path: ".cursorrules", label: ".cursorrules" },
];

export function discoverInstructionFiles(workingDir: string): string {
  const sections: string[] = [];

  for (const file of INSTRUCTION_FILES) {
    const fullPath = join(workingDir, file.path);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, "utf-8");
      sections.push(`## Repository Instructions (from ${file.label})\n\n${content}`);
    }
  }

  return sections.join("\n\n");
}
