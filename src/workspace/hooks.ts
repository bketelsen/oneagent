import { execSync } from "node:child_process";
import type { Logger } from "pino";

export function runHook(script: string | undefined, cwd: string, logger: Logger): void {
  if (!script) return;
  try {
    execSync(script, { cwd, stdio: "pipe", timeout: 30000 });
  } catch (err) {
    logger.warn({ err, script, cwd }, "workspace hook failed");
  }
}
