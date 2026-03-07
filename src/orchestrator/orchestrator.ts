import { EventEmitter } from "node:events";
import { run } from "one-agent-sdk";
import type { StreamChunk, RunConfig } from "one-agent-sdk";
import type { Config } from "../config/schema.js";
import type { GitHubClient } from "../github/client.js";
import type { Issue } from "../github/types.js";
import type { RunsRepo } from "../db/runs.js";
import type { RunEventsRepo } from "../db/run-events.js";
import type { MetricsRepo } from "../db/metrics.js";
import { RunState, type RunEntry } from "./state.js";
import { RetryQueue } from "./retry.js";
import { Dispatcher } from "./dispatcher.js";
import { buildAgentGraph, type AgentDef } from "../agents/graph.js";
import { coderAgent } from "../agents/coder.js";
import { createStallDetector } from "../middleware/stall-detector.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { ulid } from "ulid";
import type { Logger } from "pino";

export interface OrchestratorDeps {
  config: Config;
  github: GitHubClient;
  runsRepo?: RunsRepo;
  eventsRepo?: RunEventsRepo;
  metricsRepo?: MetricsRepo;
  workspace?: WorkspaceManager;
  logger: Logger;
}

export class Orchestrator {
  readonly state = new RunState();
  readonly retryQueue: RetryQueue;
  readonly sseHub = new EventEmitter();
  private dispatcher = new Dispatcher();
  private agentMap: Record<string, AgentDef>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private reconcileTimer?: ReturnType<typeof setInterval>;
  private logger: Logger;

  constructor(
    private config: Config,
    private github: GitHubClient,
    private deps: OrchestratorDeps,
  ) {
    this.retryQueue = new RetryQueue(
      config.agent.retryBaseDelay,
      config.agent.maxRetries,
    );
    const graph = buildAgentGraph();
    this.agentMap = Object.fromEntries(graph);
    this.logger = deps.logger.child({ module: "orchestrator" });
  }

  start(): void {
    this.logger.info({
      pollInterval: this.config.poll.interval,
      reconcileInterval: this.config.poll.reconcileInterval,
    }, "orchestrator started");
    this.pollTimer = setInterval(() => this.tick(), this.config.poll.interval);
    this.reconcileTimer = setInterval(() => this.reconcile(), this.config.poll.reconcileInterval);
    this.tick();
  }

  stop(): void {
    const activeCount = this.state.activeCount();
    this.logger.info({ activeCount }, "orchestrator stopping");
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    for (const [, entry] of this.state.running()) {
      entry.abortController?.abort();
    }
  }

  async tick(): Promise<void> {
    const allIssues: Issue[] = [];
    for (const repo of this.config.github.repos) {
      const issues = await this.github.fetchIssues(repo.owner, repo.repo, repo.labels);
      allIssues.push(...issues);
    }

    const retryKeys = this.retryQueue.due();
    this.logger.info({ issueCount: allIssues.length, retryCount: retryKeys.length }, "poll tick");

    for (const issue of allIssues) {
      if (this.state.isRunning(issue.key)) continue;
      if (this.state.activeCount() >= this.config.concurrency.max) {
        this.logger.debug({ max: this.config.concurrency.max }, "concurrency limit reached");
        break;
      }
      if (issue.hasOpenPR) {
        this.logger.debug({ issueKey: issue.key }, "skipping issue with open PR");
        continue;
      }

      await this.dispatch(issue);
    }

    for (const key of retryKeys) {
      if (this.state.isRunning(key)) continue;
      if (this.state.activeCount() >= this.config.concurrency.max) {
        this.logger.debug({ max: this.config.concurrency.max }, "concurrency limit reached");
        break;
      }
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
    this.logger.info({ runId, issueKey: issue.key, repo: `${issue.owner}/${issue.repo}`, issue: issue.number }, "dispatching agent");
    await this.github.addLabel(issue.owner, issue.repo, issue.number, this.config.labels.inProgress);

    this.deps.runsRepo?.insert({
      id: runId,
      issueKey: issue.key,
      provider: entry.provider,
      status: "running",
      startedAt: entry.startedAt.toISOString(),
      retryCount: entry.retryCount,
    });

    this.sseHub.emit("sse", {
      type: "agent:started",
      data: { runId, issueKey: issue.key, provider: entry.provider },
    });

    const workDir = this.deps.workspace?.ensure(issue.key);
    const prompt = this.dispatcher.buildPrompt(issue, workDir);

    // Run agent in background — don't await
    this.executeRun(runId, issue, prompt, abortController, workDir).catch((err) => {
      this.logger.error({ err, runId, issueKey: issue.key }, "unhandled run error");
    });
  }

  private async executeRun(
    runId: string,
    issue: Issue,
    prompt: string,
    abortController: AbortController,
    workDir?: string,
  ): Promise<void> {
    const stallDetector = createStallDetector(this.config.agent.stallTimeout, () => {
      this.logger.warn({ runId, issueKey: issue.key }, "agent stalled, aborting");
      abortController.abort();
    });

    try {
      const runConfig: RunConfig = {
        provider: this.config.agent.provider as any,
        agent: coderAgent as any,
        agents: this.agentMap as any,
        workDir,
        signal: abortController.signal,
      };

      const agentRun = await run(prompt, runConfig);
      stallDetector.start();

      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      for await (const chunk of agentRun.stream) {
        stallDetector.activity();
        this.state.updateActivity(issue.key);

        this.sseHub.emit("sse", {
          type: `agent:${chunk.type}`,
          data: { runId, ...chunk },
        });

        this.deps.eventsRepo?.insert(runId, chunk.type, chunk as unknown as Record<string, unknown>);

        if (chunk.type === "done" && chunk.usage) {
          totalInputTokens += chunk.usage.inputTokens;
          totalOutputTokens += chunk.usage.outputTokens;
        }
      }

      stallDetector.stop();

      // Mark completed
      const durationMs = Date.now() - (this.state.get(issue.key)?.startedAt.getTime() ?? Date.now());
      this.state.remove(issue.key);
      this.deps.runsRepo?.updateStatus(runId, "completed", new Date().toISOString());
      await this.github.removeLabel(issue.owner, issue.repo, issue.number, this.config.labels.inProgress);
      this.logger.info({ runId, issueKey: issue.key, durationMs, tokensIn: totalInputTokens, tokensOut: totalOutputTokens }, "agent run completed");

      if (totalInputTokens > 0 || totalOutputTokens > 0) {
        this.deps.metricsRepo?.record({
          runId,
          provider: this.config.agent.provider,
          tokensIn: totalInputTokens,
          tokensOut: totalOutputTokens,
          durationMs,
        });
      }

      this.sseHub.emit("sse", {
        type: "agent:completed",
        data: { runId, issueKey: issue.key },
      });

    } catch (err) {
      stallDetector.stop();
      this.state.remove(issue.key);

      const errorMsg = err instanceof Error ? err.message : String(err);
      this.deps.runsRepo?.updateStatus(runId, "failed", new Date().toISOString(), errorMsg);
      this.logger.error({ err, runId, issueKey: issue.key }, "agent run failed");

      if (this.retryQueue.canRetry(this.retryQueue.getRetryCount(issue.key))) {
        this.retryQueue.enqueue(issue.key, this.retryQueue.getRetryCount(issue.key));
        this.logger.info({ issueKey: issue.key }, "enqueued for retry");
      } else {
        await this.github.removeLabel(issue.owner, issue.repo, issue.number, this.config.labels.inProgress);
        await this.github.addLabel(issue.owner, issue.repo, issue.number, this.config.labels.failed);
        this.logger.warn({ issueKey: issue.key }, "retries exhausted, marking failed");
      }

      this.sseHub.emit("sse", {
        type: "agent:failed",
        data: { runId, issueKey: issue.key, error: errorMsg },
      });
    }
  }

  async reconcile(): Promise<void> {
    this.logger.debug({ activeRuns: this.state.activeCount() }, "reconcile check");
    for (const [key, entry] of this.state.running()) {
      const parsed = this.github.parseIssueKey(key);
      if (!parsed) continue;

      // Check for stale runs based on lastActivity
      const staleDuration = Date.now() - entry.lastActivity.getTime();
      if (staleDuration > this.config.agent.stallTimeout * 2) {
        this.logger.warn({ issueKey: key, staleDuration }, "reconcile: aborting stale run");
        entry.abortController?.abort();
      }
    }
  }
}
