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

  it("replaces missing env vars with empty string (YAML parses as null)", () => {
    delete process.env.NONEXISTENT_VAR;
    // When env var is missing, interpolation produces empty string.
    // YAML parses bare `token: ` as null, which fails zod string validation.
    const yaml = `
github:
  token: \${NONEXISTENT_VAR}
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
`;
    expect(() => loadConfigFromString(yaml)).toThrow();
  });

  it("missing env var in a compound string resolves to partial string", () => {
    delete process.env.NONEXISTENT_VAR;
    // When embedded in a larger string, the empty replacement keeps it a string
    const yaml = `
github:
  token: prefix-\${NONEXISTENT_VAR}-suffix
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
`;
    const config = loadConfigFromString(yaml);
    expect(config.github.token).toBe("prefix--suffix");
  });

  it("interpolates multiple env vars in the same string", () => {
    process.env.PART_A = "hello";
    process.env.PART_B = "world";
    const yaml = `
github:
  token: \${PART_A}-\${PART_B}
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
`;
    const config = loadConfigFromString(yaml);
    expect(config.github.token).toBe("hello-world");
    delete process.env.PART_A;
    delete process.env.PART_B;
  });

  it("failed shell command produces empty string (YAML parses as null)", () => {
    // Failed shell command returns "", YAML parses bare `token: ` as null
    const yaml = `
github:
  token: $(nonexistent_command_that_will_fail_12345)
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
`;
    expect(() => loadConfigFromString(yaml)).toThrow();
  });

  it("failed shell command in compound string resolves to partial string", () => {
    const yaml = `
github:
  token: before-$(nonexistent_command_that_will_fail_12345)-after
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
`;
    const config = loadConfigFromString(yaml);
    expect(config.github.token).toBe("before--after");
  });

  it("throws on invalid YAML syntax", () => {
    const yaml = `
github:
  repos:
    - owner: test
      repo: repo
      labels: [unclosed
`;
    expect(() => loadConfigFromString(yaml)).toThrow();
  });

  it("throws when required fields are missing", () => {
    // missing repos entirely
    expect(() => loadConfigFromString("github:\n  token: abc")).toThrow();
  });

  it("throws when repos array is empty", () => {
    const yaml = `
github:
  repos: []
`;
    expect(() => loadConfigFromString(yaml)).toThrow();
  });

  it("applies all default values for optional sections", () => {
    const yaml = `
github:
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
`;
    const config = loadConfigFromString(yaml);
    // agent defaults
    expect(config.agent.provider).toBe("claude-code");
    expect(config.agent.stallTimeout).toBe(300000);
    expect(config.agent.maxRetries).toBe(3);
    expect(config.agent.retryBaseDelay).toBe(60000);
    // concurrency defaults
    expect(config.concurrency.max).toBe(3);
    // poll defaults
    expect(config.poll.interval).toBe(30000);
    expect(config.poll.reconcileInterval).toBe(15000);
    // workspace defaults
    expect(config.workspace.baseDir).toBe("./workspaces");
    // web defaults
    expect(config.web.port).toBe(3000);
    expect(config.web.enabled).toBe(true);
    // labels defaults
    expect(config.labels.eligible).toBe("oneagent");
    expect(config.labels.inProgress).toBe("oneagent-working");
    expect(config.labels.failed).toBe("oneagent-failed");
    // project statuses defaults
    expect(config.project.statuses.todo).toBe("Todo");
    expect(config.project.statuses.inProgress).toBe("In Progress");
    expect(config.project.statuses.inReview).toBe("In Review");
    expect(config.project.statuses.done).toBe("Done");
  });

  it("allows overriding default values", () => {
    const yaml = `
github:
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
agent:
  provider: codex
  stallTimeout: 600000
web:
  port: 8080
  enabled: false
concurrency:
  max: 10
`;
    const config = loadConfigFromString(yaml);
    expect(config.agent.provider).toBe("codex");
    expect(config.agent.stallTimeout).toBe(600000);
    expect(config.web.port).toBe(8080);
    expect(config.web.enabled).toBe(false);
    expect(config.concurrency.max).toBe(10);
  });

  it("handles string with no interpolation markers", () => {
    const yaml = `
github:
  token: plain-token
  repos:
    - owner: test
      repo: repo
      labels: [oneagent]
`;
    const config = loadConfigFromString(yaml);
    expect(config.github.token).toBe("plain-token");
  });

  it("throws when top-level github key is missing", () => {
    expect(() => loadConfigFromString("agent:\n  provider: codex")).toThrow();
  });
});
