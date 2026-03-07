import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../parse-frontmatter.js";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter and body", () => {
    const input = `---
name: my-skill
description: A test skill
---

Body content here.`;
    const result = parseFrontmatter(input);
    expect(result.attributes).toEqual({ name: "my-skill", description: "A test skill" });
    expect(result.body.trim()).toBe("Body content here.");
  });

  it("returns empty attributes when no frontmatter", () => {
    const input = "Just body content, no frontmatter.";
    const result = parseFrontmatter(input);
    expect(result.attributes).toEqual({});
    expect(result.body).toBe("Just body content, no frontmatter.");
  });

  it("handles empty body after frontmatter", () => {
    const input = `---
name: empty-body
description: Nothing below
---`;
    const result = parseFrontmatter(input);
    expect(result.attributes).toEqual({ name: "empty-body", description: "Nothing below" });
    expect(result.body.trim()).toBe("");
  });

  it("handles frontmatter with extra fields", () => {
    const input = `---
name: skill
description: desc
custom: value
---

Body.`;
    const result = parseFrontmatter(input);
    expect(result.attributes).toEqual({ name: "skill", description: "desc", custom: "value" });
  });

  it("handles malformed YAML gracefully", () => {
    const input = `---
key: [unterminated
---

Body after bad yaml.`;
    const result = parseFrontmatter(input);
    expect(result.attributes).toEqual({});
    expect(result.body.trim()).toBe("Body after bad yaml.");
  });
});
