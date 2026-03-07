import { parse as parseYaml } from "yaml";

export interface FrontmatterResult {
  attributes: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { attributes: {}, body: content };
  }
  let attributes: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(match[1]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      attributes = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed YAML — treat as no frontmatter
  }
  return { attributes, body: match[2] };
}
