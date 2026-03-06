import { parse as parseYaml } from "yaml";
import { execSync } from "node:child_process";
import { configSchema, type Config } from "./schema.js";

function interpolateEnvVars(str: string): string {
  return str.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

function interpolateShellCommands(str: string): string {
  return str.replace(/\$\(([^)]+)\)/g, (_, cmd) => {
    try {
      return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim();
    } catch {
      return "";
    }
  });
}

export function loadConfigFromString(yamlStr: string): Config {
  const withEnv = interpolateEnvVars(yamlStr);
  const interpolated = interpolateShellCommands(withEnv);
  const raw = parseYaml(interpolated);
  return configSchema.parse(raw);
}
