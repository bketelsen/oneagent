import { describe, it, expect } from "vitest";
import { loadConfigFromString } from "../loader.js";

describe("loadConfigFromString", () => {
  it("parses YAML and validates with schema", () => {
    const yaml = `
github:
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
agent:
  provider: codex
`;
    const config = loadConfigFromString(yaml);
    expect(config.agent.provider).toBe("codex");
    expect(config.web.port).toBe(3000);
  });

  it("interpolates env vars", () => {
    process.env.TEST_TOKEN = "abc123";
    const yaml = `
github:
  token: \${TEST_TOKEN}
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
`;
    const config = loadConfigFromString(yaml);
    expect(config.github.token).toBe("abc123");
    delete process.env.TEST_TOKEN;
  });

  it("interpolates shell commands", () => {
    const yaml = `
github:
  token: $(echo shelltoken)
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
`;
    const config = loadConfigFromString(yaml);
    expect(config.github.token).toBe("shelltoken");
  });

  it("throws on invalid config", () => {
    expect(() => loadConfigFromString("github: {}")).toThrow();
  });
});
