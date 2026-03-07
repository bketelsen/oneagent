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
  latestCommentId: number;
  prompt: string;
  headRef: string;
}

export class PRMonitor {
  private timer?: ReturnType<typeof setInterval>;
  private reviewTimer?: ReturnType<typeof setInterval>;
  private dispatcher = new Dispatcher();

  /** Tracks the last processed review comment ID per PR key to avoid re-processing */
  private lastProcessedCommentIds = new Map<string, number>();

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

  /** Mark a PR's review comments as processed up to the given comment ID */
  markReviewProcessed(prKey: string, latestCommentId: number): void {
    this.lastProcessedCommentIds.set(prKey, latestCommentId);
  }

  /** Get the last processed comment ID for a PR (for testing/inspection) */
  getLastProcessedCommentId(prKey: string): number | undefined {
    return this.lastProcessedCommentIds.get(prKey);
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
        this.lastProcessedCommentIds,
      );

      for (const { pr, comments, latestCommentId } of prsWithFeedback) {
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
          latestCommentId,
          prompt,
          headRef: pr.headRef,
        });

        this.logger?.info(
          { pr: pr.key, newComments: comments.length, latestCommentId },
          "PR review feedback detected",
        );
      }
    }

    return results;
  }
}
