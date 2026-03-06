import type { Config } from "../config/schema.js";
import type { GitHubClient } from "../github/client.js";
import { Dispatcher } from "./dispatcher.js";
import type { Logger } from "pino";

export class PRMonitor {
  private timer?: ReturnType<typeof setInterval>;
  private dispatcher = new Dispatcher();

  constructor(
    private config: Config,
    private github: GitHubClient,
    private logger?: Logger,
  ) {}

  start(intervalMs: number): void {
    this.timer = setInterval(() => this.check(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async check(): Promise<{ repo: string; pr: number; failures: string[] }[]> {
    const results: { repo: string; pr: number; failures: string[] }[] = [];

    for (const repo of this.config.github.repos) {
      const prs = await this.github.fetchPRsWithLabel(repo.owner, repo.repo, this.config.labels.inProgress);
      for (const pr of prs) {
        const checks = await this.github.fetchCheckRuns(pr.owner, pr.repo, pr.headRef);
        const failed = checks.filter((c) => c.conclusion === "failure");
        if (failed.length > 0) {
          const failures = failed.map((c) => `${c.name}: ${c.conclusion}`);
          const failureLog = failures.join("\n");
          const prompt = this.dispatcher.buildPRFixPrompt(pr, failureLog);
          results.push({ repo: `${pr.owner}/${pr.repo}`, pr: pr.number, failures });
          this.logger?.info({ pr: pr.key, failures: failures.length }, "CI failure detected");
          // Dispatch would be wired through orchestrator
        }
      }
    }

    return results;
  }
}
