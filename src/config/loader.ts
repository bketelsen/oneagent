import { parse as parseYaml } from "yaml";
import { configSchema, type Config } from "./schema.js";

function interpolateEnvVars(str: string): string {
  return str.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

export function loadConfigFromString(yamlStr: string): Config {
  const interpolated = interpolateEnvVars(yamlStr);
  const raw = parseYaml(interpolated);
  return configSchema.parse(raw);
}
