import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export class WorkspaceManager {
  constructor(private baseDir: string) {
    mkdirSync(baseDir, { recursive: true });
  }

  ensure(issueKey: string): string {
    const dirName = issueKey.replace(/[/#]/g, "-");
    const dir = join(this.baseDir, dirName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  path(issueKey: string): string {
    return join(this.baseDir, issueKey.replace(/[/#]/g, "-"));
  }
}
