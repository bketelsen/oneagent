import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import pino, { type Logger } from "pino";

export class WorkspaceManager {
  private logger: Logger;

  constructor(private baseDir: string, logger?: Logger) {
    mkdirSync(baseDir, { recursive: true });
    this.logger = (logger ?? pino({ level: "silent" })).child({ module: "workspace" });
  }

  ensure(issueKey: string): string {
    const dirName = issueKey.replace(/[/#]/g, "-");
    const dir = join(this.baseDir, dirName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      this.logger.info({ issueKey, dir }, "workspace created");
    }
    return dir;
  }

  path(issueKey: string): string {
    return join(this.baseDir, issueKey.replace(/[/#]/g, "-"));
  }
}
