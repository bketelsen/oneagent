import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import { parseFrontmatter } from "./parse-frontmatter.js";

const INSTRUCTION_FILES = [
  { path: "CLAUDE.md", label: "CLAUDE.md" },
  { path: "AGENTS.md", label: "AGENTS.md" },
  { path: ".github/copilot-instructions.md", label: ".github/copilot-instructions.md" },
  { path: ".cursorrules", label: ".cursorrules" },
  { path: ".oneagent/instructions.md", label: ".oneagent/instructions.md" },
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

const SKILLS_DIR = ".oneagent/skills";

export function discoverCustomSkills(workingDir: string): string {
  const skillsPath = join(workingDir, SKILLS_DIR);
  if (!existsSync(skillsPath)) return "";

  const files = readdirSync(skillsPath).filter((f) => f.endsWith(".md"));
  const sections: string[] = [];

  for (const file of files) {
    const content = readFileSync(join(skillsPath, file), "utf-8");
    const { attributes, body } = parseFrontmatter(content);

    if (!attributes.name || !attributes.description) continue;

    sections.push(
      `## Custom Skill: ${attributes.name}\n${attributes.description}\n\n${body.trim()}`
    );
  }

  return sections.join("\n\n");
}

export function discoverRepoContext(workingDir: string): string {
  const instructions = discoverInstructionFiles(workingDir);
  const skills = discoverCustomSkills(workingDir);

  const parts = [instructions, skills].filter(Boolean);
  if (parts.length === 0) return "No project-specific instructions or skills found.";

  return parts.join("\n\n");
}

export const discoverRepoContextTool = defineTool({
  name: "discover_repo_context",
  description:
    "Scan the repository for project-specific instructions (CLAUDE.md, AGENTS.md, copilot instructions, .cursorrules) and custom skills (.oneagent/skills/*.md). Call this after entering the repository.",
  parameters: z.object({
    workingDir: z.string().describe("Absolute path to the repository root"),
  }),
  handler: async ({ workingDir }) => {
    return discoverRepoContext(workingDir);
  },
});
