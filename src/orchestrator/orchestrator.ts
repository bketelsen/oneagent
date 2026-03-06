import { EventEmitter } from "node:events";
import type { Config } from "../config/schema.js";
import type { GitHubClient } from "../github/client.js";
import type { Issue } from "../github/types.js";
import { RunState, type RunEntry } from "./state.js";
import { RetryQueue } from "./retry.js";
import { Dispatcher } from "./dispatcher.js";
import { ulid } from "ulid";

export class Orchestrator {
  readonly state = new RunState();
  readonly retryQueue: RetryQueue;
  readonly sseHub = new EventEmitter();
  private dispatcher = new Dispatcher();
  private pollTimer?: ReturnType<typeof setInterval>;
  private reconcileTimer?: ReturnType<typeof setInterval>;

  constructor(
    private config: Config,
    private github: GitHubClient,
  ) {
    this.retryQueue = new RetryQueue(
      config.agent.retryBaseDelay,
      config.agent.maxRetries,
    );
  }

  start(): void {
    this.pollTimer = setInterval(() => this.tick(), this.config.poll.interval);
    this.reconcileTimer = setInterval(() => this.reconcile(), this.config.poll.reconcileInterval);
    this.tick();
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    for (const [, entry] of this.state.running()) {
      entry.abortController?.abort();
    }
  }

  async tick(): Promise<void> {
    const allIssues: Issue[] = [];
    for (const repo of this.config.github.repos) {
      for (const label of repo.labels) {
        const issues = await this.github.fetchIssues(repo.owner, repo.repo, label);
        allIssues.push(...issues);
      }
    }

    const retryKeys = this.retryQueue.due();

    for (const issue of allIssues) {
      if (this.state.isRunning(issue.key)) continue;
      if (this.state.activeCount() >= this.config.concurrency.max) break;
      if (issue.hasOpenPR) continue;

      await this.dispatch(issue);
    }

    for (const key of retryKeys) {
      if (this.state.isRunning(key)) continue;
      if (this.state.activeCount() >= this.config.concurrency.max) break;
      this.retryQueue.dequeue(key);
      const parsed = this.github.parseIssueKey(key);
      if (!parsed) continue;
      const issues = await this.github.fetchIssues(parsed.owner, parsed.repo, this.config.labels.eligible);
      const issue = issues.find((i) => i.key === key);
      if (issue) await this.dispatch(issue);
    }
  }

  private async dispatch(issue: Issue): Promise<void> {
    const runId = ulid();
    const abortController = new AbortController();

    const entry: RunEntry = {
      runId,
      issueKey: issue.key,
      provider: this.config.agent.provider,
      startedAt: new Date(),
      lastActivity: new Date(),
      retryCount: this.retryQueue.getRetryCount(issue.key),
      abortController,
    };

    this.state.add(issue.key, entry);
    await this.github.addLabel(issue.owner, issue.repo, issue.number, this.config.labels.inProgress);

    this.sseHub.emit("sse", {
      type: "agent:started",
      data: { runId, issueKey: issue.key, provider: entry.provider },
    });

    // Agent execution will be wired in the integration task
  }

  async reconcile(): Promise<void> {
    for (const [key] of this.state.running()) {
      const parsed = this.github.parseIssueKey(key);
      if (!parsed) continue;
      // Full reconciliation added in integration task
    }
  }
}
