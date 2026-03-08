import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import pino, { type Logger } from "pino";
import { runHook } from "./hooks.js";

export class WorkspaceManager {
  private logger: Logger;
  private hooks?: { setup?: string; teardown?: string };

  constructor(private baseDir: string, logger?: Logger, hooks?: { setup?: string; teardown?: string }) {
    this.baseDir = resolve(baseDir);
    mkdirSync(this.baseDir, { recursive: true });
    this.logger = (logger ?? pino({ level: "silent" })).child({ module: "workspace" });
    this.hooks = hooks;
  }

  ensure(issueKey: string): string {
    const dirName = issueKey.replace(/[/#]/g, "-");
    const dir = join(this.baseDir, dirName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      this.logger.info({ issueKey, dir }, "workspace created");
      runHook(this.hooks?.setup, dir, this.logger);
    }
    return dir;
  }

  cleanup(issueKey: string): void {
    const dir = this.path(issueKey);
    runHook(this.hooks?.teardown, dir, this.logger);
    rmSync(dir, { recursive: true, force: true });
    this.logger.info({ issueKey, dir }, "workspace cleaned up");
  }

  path(issueKey: string): string {
    return join(this.baseDir, issueKey.replace(/[/#]/g, "-"));
  }
}
