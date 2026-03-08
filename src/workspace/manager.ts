import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import pino, { type Logger } from "pino";
import { runHook } from "./hooks.js";

export class WorkspaceManager {
  private logger: Logger;
  private hooks?: { setup?: string; teardown?: string };
  private githubToken?: string;

  constructor(
    private baseDir: string,
    logger?: Logger,
    hooks?: { setup?: string; teardown?: string },
    githubToken?: string,
  ) {
    this.baseDir = resolve(baseDir);
    mkdirSync(this.baseDir, { recursive: true });
    this.logger = (logger ?? pino({ level: "silent" })).child({ module: "workspace" });
    this.hooks = hooks;
    this.githubToken = githubToken;
  }

  ensure(issueKey: string): string {
    const dirName = issueKey.replace(/[/#]/g, "-");
    const dir = join(this.baseDir, dirName);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      this.logger.info({ issueKey, dir }, "workspace created");
      runHook(this.hooks?.setup, dir, this.logger);
    }

    // Clone the repo if the workspace has no git repo yet
    if (!existsSync(join(dir, ".git"))) {
      const parsed = this.parseIssueKey(issueKey);
      if (parsed) {
        this.cloneRepo(parsed.owner, parsed.repo, dir);
      }
    }

    return dir;
  }

  cleanup(issueKey: string): void {
    const dir = this.path(issueKey);
    if (!existsSync(dir)) return;
    runHook(this.hooks?.teardown, dir, this.logger);
    rmSync(dir, { recursive: true, force: true });
    this.logger.info({ issueKey, dir }, "workspace cleaned up");
  }

  path(issueKey: string): string {
    return join(this.baseDir, issueKey.replace(/[/#]/g, "-"));
  }

  private parseIssueKey(issueKey: string): { owner: string; repo: string } | null {
    // issueKey format: "owner/repo#number" or "pr-agent-review:owner/repo#number"
    const cleaned = issueKey.replace(/^(pr-agent-review:|pr-review:)/, "");
    const match = cleaned.match(/^([^/]+)\/([^#]+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  }

  private cloneRepo(owner: string, repo: string, dir: string): void {
    const token = this.githubToken;
    const cloneUrl = token
      ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
      : `https://github.com/${owner}/${repo}.git`;

    try {
      this.logger.info({ owner, repo, dir }, "cloning repo into workspace");
      execFileSync("git", ["clone", "--depth", "1", cloneUrl, "."], {
        cwd: dir,
        stdio: "pipe",
        timeout: 120000,
      });
    } catch (err) {
      this.logger.error({ err, owner, repo, dir }, "failed to clone repo into workspace");
    }
  }
}
