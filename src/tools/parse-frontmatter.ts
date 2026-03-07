import { parse as parseYaml } from "yaml";

export interface FrontmatterResult {
  attributes: Record<string, string>;
  body: string;
}

export function parseFrontmatter(content: string): FrontmatterResult {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { attributes: {}, body: content };
  }
  const attributes = parseYaml(match[1]) ?? {};
  return { attributes, body: match[2] };
}
