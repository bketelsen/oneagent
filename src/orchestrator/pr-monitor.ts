import type { Config } from "../config/schema.js";
import type { GitHubClient } from "../github/client.js";
import type { PRWithReviewFeedback } from "../github/types.js";
import { Dispatcher } from "./dispatcher.js";
import type { Logger } from "pino";

export interface ReviewFeedbackResult {
  repo: string;
  pr: number;
  prKey: string;
  commentCount: number;
  latestTimestamp: string;
  prompt: string;
  headRef: string;
}

export class PRMonitor {
  private timer?: ReturnType<typeof setInterval>;
  private reviewTimer?: ReturnType<typeof setInterval>;
  private dispatcher = new Dispatcher();

  /** Tracks the last processed review comment timestamp per PR key to avoid re-processing */
  private lastProcessedTimestamps = new Map<string, string>();

  constructor(
    private config: Config,
    private github: GitHubClient,
    private logger?: Logger,
  ) {}

  start(intervalMs: number): void {
    this.timer = setInterval(() => this.check(), intervalMs);
  }

  startReviewPolling(intervalMs: number): void {
    this.reviewTimer = setInterval(() => this.checkReviewFeedback(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.reviewTimer) clearInterval(this.reviewTimer);
  }

  /** Mark a PR's review comments as processed up to the given timestamp */
  markReviewProcessed(prKey: string, latestTimestamp: string): void {
    this.lastProcessedTimestamps.set(prKey, latestTimestamp);
  }

  /** Get the last processed timestamp for a PR (for testing/inspection) */
  getLastProcessedTimestamp(prKey: string): string | undefined {
    return this.lastProcessedTimestamps.get(prKey);
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

  async checkReviewFeedback(): Promise<ReviewFeedbackResult[]> {
    const results: ReviewFeedbackResult[] = [];

    for (const repo of this.config.github.repos) {
      const prsWithFeedback = await this.github.fetchPRsWithReviewFeedback(
        repo.owner,
        repo.repo,
        this.config.labels.inProgress,
        this.lastProcessedTimestamps,
      );

      for (const { pr, comments, latestTimestamp } of prsWithFeedback) {
        let diff = "";
        try {
          diff = await this.github.fetchPRDiff(pr.owner, pr.repo, pr.number);
        } catch {
          this.logger?.warn({ pr: pr.key }, "failed to fetch PR diff");
        }

        const prompt = this.dispatcher.buildPRReviewPrompt(pr, comments, diff);

        results.push({
          repo: `${pr.owner}/${pr.repo}`,
          pr: pr.number,
          prKey: pr.key,
          commentCount: comments.length,
          latestTimestamp,
          prompt,
          headRef: pr.headRef,
        });

        this.logger?.info(
          { pr: pr.key, newComments: comments.length, latestTimestamp },
          "PR review feedback detected",
        );
      }
    }

    return results;
  }
}
