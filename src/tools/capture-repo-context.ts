import { execFileSync } from "node:child_process";
import { discoverRepoContext } from "./repo-context.js";

const EXCLUDED_DIRS = [".git", "node_modules", "dist", ".next", "__pycache__", ".venv", "vendor"];
const MAX_FILES = 500;

function listFiles(dir: string): string[] {
  const excludeArgs = EXCLUDED_DIRS.flatMap((d) => ["-not", "-path", `./${d}/*`, "-not", "-path", `./${d}`]);
  try {
    const output = execFileSync(
      "find", [".", "-type", "f", ...excludeArgs],
      { cwd: dir, encoding: "utf-8", timeout: 10000 },
    );
    return output.trim().split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, "")).sort();
  } catch {
    return [];
  }
}

export function captureRepoContext(repoDir: string): string {
  const sections: string[] = [];

  const instructions = discoverRepoContext(repoDir);
  if (instructions !== "No project-specific instructions or skills found.") {
    sections.push(instructions);
  }

  const files = listFiles(repoDir);
  const truncated = files.length > MAX_FILES;
  const listed = files.slice(0, MAX_FILES);

  let dirSection = "## Directory Structure\n\n";
  dirSection += listed.map((f) => `- ${f}`).join("\n");
  if (truncated) {
    dirSection += `\n\n_(truncated — showing ${MAX_FILES} of ${files.length} files)_`;
  }
  sections.push(dirSection);

  return sections.join("\n\n");
}
