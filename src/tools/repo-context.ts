import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./parse-frontmatter.js";

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
