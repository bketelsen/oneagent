import { SSEHub } from "../web/sse.js";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, rmSync } from "node:fs";
import { run } from "one-agent-sdk";
import type { StreamChunk, RunConfig } from "one-agent-sdk";
import type { Config } from "../config/schema.js";
import type { GitHubClient } from "../github/client.js";
import type { Issue, PullRequest } from "../github/types.js";
import type { RunsRepo } from "../db/runs.js";
import type { RunEventsRepo } from "../db/run-events.js";
import type { MetricsRepo } from "../db/metrics.js";
import { RunState, ReviewCycleState, type RunEntry } from "./state.js";
import { RetryQueue } from "./retry.js";
import { Dispatcher } from "./dispatcher.js";
import { PRMonitor, type ReviewFeedbackResult } from "./pr-monitor.js";
import { buildAgentGraph, type AgentDef } from "../agents/graph.js";
import { coderAgent } from "../agents/coder.js";
import { prReviewerAgent } from "../agents/skills/pr-reviewer.js";
import { createReviewTools, type ReviewVerdict } from "../tools/review.js";
import { createStallDetector } from "../middleware/stall-detector.js";
import { logHandoff } from "../middleware/logging.js";
import { WorkspaceManager } from "../workspace/manager.js";
import { discoverRepoContext } from "../tools/repo-context.js";
import { ulid } from "ulid";
import type { Logger } from "pino";

const execFile = promisify(execFileCb);

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
  readonly sseHub = new SSEHub();
  readonly prMonitor: PRMonitor;
  private dispatcher = new Dispatcher();
  private repoContextLoaded = false;
  private agentMap: Record<string, AgentDef>;
  private pollTimer?: ReturnType<typeof setInterval>;
  private reconcileTimer?: ReturnType<typeof setInterval>;
  private reviewTimer?: ReturnType<typeof setInterval>;
  private logger: Logger;
  readonly reviewCycles = new ReviewCycleState();
  private reviewVerdicts = new Map<string, () => ReviewVerdict | null>();

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
    this.prMonitor = new PRMonitor(config, github, this.logger);
  }

  reloadConfig(newConfig: Config): void {
    this.config = newConfig;
    this.logger.info("config reloaded, will take effect on next tick");
  }

  start(): void {
    this.logger.info({
      pollInterval: this.config.poll.interval,
      reconcileInterval: this.config.poll.reconcileInterval,
    }, "orchestrator started");
    this.pollTimer = setInterval(() => this.tick(), this.config.poll.interval);
    this.reconcileTimer = setInterval(() => this.reconcile(), this.config.poll.reconcileInterval);

    if (this.config.prReview.enabled) {
      const reviewInterval = this.config.prReview.pollInterval;
      this.logger.info({ reviewPollInterval: reviewInterval }, "PR review feedback polling enabled");
      this.reviewTimer = setInterval(() => this.tickReviewFeedback(), reviewInterval);

      // Also poll for PRs needing review (manual trigger via label)
      setInterval(() => this.tickReviewDispatch(), reviewInterval);
    }

    this.tick();
  }

  stop(): void {
    const activeCount = this.state.activeCount();
    this.logger.info({ activeCount }, "orchestrator stopping");
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.reviewTimer) clearInterval(this.reviewTimer);
    this.prMonitor.stop();
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

      // Check if a merged PR already resolves this issue
      const mergedPR = await this.github.findMergedPRForIssue(issue.owner, issue.repo, issue.number);
      if (mergedPR) {
        this.logger.info({ issueKey: issue.key, prNumber: mergedPR.number }, "skipping issue already resolved by merged PR");
        await this.github.addComment(
          issue.owner, issue.repo, issue.number,
          `This issue appears to have been resolved by PR #${mergedPR.number} (merged). Skipping. Consider closing this issue.`,
        );
        continue;
      }

      // Check issue dependencies
      const deps = this.github.parseDependencies(issue.body);
      if (deps.length > 0) {
        let blocked = false;
        for (const dep of deps) {
          const closed = await this.github.isIssueClosed(issue.owner, issue.repo, dep);
          if (!closed) {
            this.logger.info({ issueKey: issue.key, blockedBy: dep }, "skipping issue with open dependency");
            blocked = true;
            break;
          }
        }
        if (blocked) continue;
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

  async tickReviewDispatch(): Promise<void> {
    if (!this.config.prReview.enabled) return;

    for (const repo of this.config.github.repos) {
      const prs = await this.github.fetchPRsWithLabel(
        repo.owner,
        repo.repo,
        this.config.labels.needsReview,
      );

      for (const pr of prs) {
        const prRunKey = `pr-agent-review:${pr.key}`;
        if (this.state.isRunning(prRunKey)) continue;
        if (this.state.activeCount() >= this.config.concurrency.max) break;

        if (!this.reviewCycles.isExhausted(pr.key, this.config.prReview.maxReviewCycles)) {
          await this.dispatchReview(pr);
        }
      }
    }
  }

  async tickReviewFeedback(): Promise<void> {
    if (!this.config.prReview.enabled) return;

    const results = await this.prMonitor.checkReviewFeedback();
    this.logger.info({ reviewFeedbackCount: results.length }, "review feedback tick");

    for (const result of results) {
      const prRunKey = `pr-review:${result.prKey}`;
      if (this.state.isRunning(prRunKey)) continue;
      if (this.state.activeCount() >= this.config.concurrency.max) {
        this.logger.debug({ max: this.config.concurrency.max }, "concurrency limit reached, skipping review dispatch");
        break;
      }

      await this.dispatchReviewFeedback(result, prRunKey);
    }
  }

  private async dispatchReviewFeedback(result: ReviewFeedbackResult, prRunKey: string): Promise<void> {
    const runId = ulid();
    const abortController = new AbortController();

    const entry: RunEntry = {
      runId,
      issueKey: prRunKey,
      provider: this.config.agent.provider,
      startedAt: new Date(),
      lastActivity: new Date(),
      retryCount: 0,
      abortController,
      currentAgent: "coder",
      lastActivityDescription: "Starting...",
      toolCallCount: 0,
    };

    this.state.add(prRunKey, entry);
    this.logger.info({ runId, prKey: result.prKey, commentCount: result.commentCount }, "dispatching PR review feedback agent");

    this.deps.runsRepo?.insert({
      id: runId,
      issueKey: prRunKey,
      provider: entry.provider,
      status: "running",
      startedAt: entry.startedAt.toISOString(),
      retryCount: 0,
    });

    this.sseHub.broadcast("agent:started", { runId, issueKey: prRunKey, provider: entry.provider });

    // Mark these comments as processed immediately to avoid re-dispatch
    this.prMonitor.markReviewProcessed(result.prKey, result.latestCommentId);

    const workDir = this.deps.workspace?.ensure(prRunKey);

    // Run agent in background
    this.executeReviewRun(runId, prRunKey, result.prompt, abortController, workDir).catch((err) => {
      this.logger.error({ err, runId, prKey: result.prKey }, "unhandled review run error");
    });
  }

  private async executeReviewRun(
    runId: string,
    prRunKey: string,
    prompt: string,
    abortController: AbortController,
    workDir?: string,
  ): Promise<void> {
    const stallDetector = createStallDetector(this.config.agent.stallTimeout, () => {
      this.logger.warn({ runId, prRunKey }, "review agent stalled, aborting");
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
        this.state.updateActivity(prRunKey);

        const entry = this.state.get(prRunKey);
        if (entry) {
          if (chunk.type === "tool_call") {
            const toolChunk = chunk as unknown as { toolName?: string };
            entry.lastActivityDescription = `Called ${toolChunk.toolName ?? "unknown"}`;
            entry.toolCallCount++;
          } else if (chunk.type === "handoff") {
            const handoffChunk = chunk as unknown as { toAgent: string };
            entry.currentAgent = handoffChunk.toAgent;
          } else if (chunk.type === "text") {
            const textChunk = chunk as unknown as { content?: string };
            const content = textChunk.content ?? "";
            entry.lastActivityDescription = content.length > 80 ? content.slice(0, 80) : (content || "Thinking...");
          }
        }

        this.sseHub.broadcast(`agent:${chunk.type}`, { runId, ...chunk });

        this.deps.eventsRepo?.insert(runId, chunk.type, chunk as unknown as Record<string, unknown>);

        if (chunk.type === "handoff") {
          const { fromAgent, toAgent } = chunk as unknown as { fromAgent: string; toAgent: string };
          logHandoff(fromAgent, toAgent, runId, 0, this.logger);
        }

        if (chunk.type === "done" && chunk.usage) {
          totalInputTokens += chunk.usage.inputTokens;
          totalOutputTokens += chunk.usage.outputTokens;
        }
      }

      stallDetector.stop();

      const durationMs = Date.now() - (this.state.get(prRunKey)?.startedAt.getTime() ?? Date.now());
      this.state.remove(prRunKey);
      this.deps.runsRepo?.updateStatus(runId, "completed", new Date().toISOString());
      this.logger.info({ runId, prRunKey, durationMs, tokensIn: totalInputTokens, tokensOut: totalOutputTokens }, "review feedback agent run completed");

      if (totalInputTokens > 0 || totalOutputTokens > 0) {
        this.deps.metricsRepo?.record({
          runId,
          provider: this.config.agent.provider,
          tokensIn: totalInputTokens,
          tokensOut: totalOutputTokens,
          durationMs,
        });
      }

      this.sseHub.broadcast("agent:completed", { runId, issueKey: prRunKey });

      // After coder addresses review feedback, re-dispatch review agent
      if (this.config.prReview.enabled && prRunKey.startsWith("pr-review:")) {
        const parsed = this.github.parseIssueKey(prRunKey.replace("pr-review:", ""));
        if (parsed) {
          const prs = await this.github.fetchOpenPRs(parsed.owner, parsed.repo);
          const pr = prs.find((p) => p.key === prRunKey.replace("pr-review:", ""));
          if (pr && !this.reviewCycles.isExhausted(pr.key, this.config.prReview.maxReviewCycles)) {
            this.logger.info({ prKey: pr.key }, "coder addressed feedback, re-dispatching review");
            await this.dispatchReview(pr).catch((err) => {
              this.logger.error({ err, prKey: pr.key }, "failed to re-dispatch review agent");
            });
          }
        }
      }
    } catch (err) {
      stallDetector.stop();
      this.state.remove(prRunKey);

      const errorMsg = err instanceof Error ? err.message : String(err);
      this.deps.runsRepo?.updateStatus(runId, "failed", new Date().toISOString(), errorMsg);
      this.logger.error({ err, runId, prRunKey }, "review feedback agent run failed");

      this.sseHub.broadcast("agent:failed", { runId, issueKey: prRunKey, error: errorMsg });
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
      currentAgent: "coder",
      lastActivityDescription: "Starting...",
      toolCallCount: 0,
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

    this.sseHub.broadcast("agent:started", { runId, issueKey: issue.key, provider: entry.provider });

    const workDir = this.deps.workspace?.ensure(issue.key);
    if (!this.repoContextLoaded && workDir) {
      const ctx = discoverRepoContext(workDir);
      this.dispatcher.setRepoContext(ctx);
      this.prMonitor.setRepoContext(ctx);
      this.repoContextLoaded = true;
    }
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

        const entry = this.state.get(issue.key);
        if (entry) {
          if (chunk.type === "tool_call") {
            const toolChunk = chunk as unknown as { toolName?: string };
            entry.lastActivityDescription = `Called ${toolChunk.toolName ?? "unknown"}`;
            entry.toolCallCount++;
          } else if (chunk.type === "handoff") {
            const handoffChunk = chunk as unknown as { toAgent: string };
            entry.currentAgent = handoffChunk.toAgent;
          } else if (chunk.type === "text") {
            const textChunk = chunk as unknown as { content?: string };
            const content = textChunk.content ?? "";
            entry.lastActivityDescription = content.length > 80 ? content.slice(0, 80) : (content || "Thinking...");
          }
        }

        this.sseHub.broadcast(`agent:${chunk.type}`, { runId, ...chunk });

        this.deps.eventsRepo?.insert(runId, chunk.type, chunk as unknown as Record<string, unknown>);

        if (chunk.type === "handoff") {
          const { fromAgent, toAgent } = chunk as unknown as { fromAgent: string; toAgent: string };
          logHandoff(fromAgent, toAgent, runId, issue.number, this.logger);
        }

        if (chunk.type === "done" && chunk.usage) {
          totalInputTokens += chunk.usage.inputTokens;
          totalOutputTokens += chunk.usage.outputTokens;
        }
      }

      stallDetector.stop();

      // Mark completed
      const durationMs = Date.now() - (this.state.get(issue.key)?.startedAt.getTime() ?? Date.now());
      this.state.remove(issue.key);
      this.deps.runsRepo?.completeRun(runId, "completed", new Date().toISOString(), durationMs);
      await this.github.removeLabel(issue.owner, issue.repo, issue.number, this.config.labels.inProgress);
      await this.github.removeLabel(issue.owner, issue.repo, issue.number, this.config.labels.eligible);
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


      // After successful run, rebase any conflicting PRs
      await this.rebaseConflictingPRs(issue.owner, issue.repo).catch((err) => {
        this.logger.error({ err, owner: issue.owner, repo: issue.repo }, "rebase conflicting PRs failed");
      });

      // After successful coder run, dispatch review agent if enabled
      if (this.config.prReview.enabled) {
        const pr = await this.findPRForIssue(issue.key);
        if (pr) {
          this.logger.info({ issueKey: issue.key, prKey: pr.key }, "coder run produced PR, dispatching review");
          await this.dispatchReview(pr).catch((err) => {
            this.logger.error({ err, issueKey: issue.key }, "failed to dispatch review agent");
          });
        }
      }

    } catch (err) {
      stallDetector.stop();

      const errorMsg = err instanceof Error ? err.message : String(err);
      const failDurationMs = Date.now() - (this.state.get(issue.key)?.startedAt.getTime() ?? Date.now());
      this.state.remove(issue.key);
      this.deps.runsRepo?.completeRun(runId, "failed", new Date().toISOString(), failDurationMs, errorMsg);
      this.logger.error({ err, runId, issueKey: issue.key }, "agent run failed");

      await this.github.removeLabel(issue.owner, issue.repo, issue.number, this.config.labels.inProgress);

      if (this.retryQueue.canRetry(this.retryQueue.getRetryCount(issue.key))) {
        this.retryQueue.enqueue(issue.key, this.retryQueue.getRetryCount(issue.key));
        this.logger.info({ issueKey: issue.key }, "enqueued for retry");
      } else {
        await this.github.addLabel(issue.owner, issue.repo, issue.number, this.config.labels.failed);
        this.logger.warn({ issueKey: issue.key }, "retries exhausted, marking failed");
      }

      this.sseHub.broadcast("agent:failed", { runId, issueKey: issue.key, error: errorMsg });
    }
  }

  private async findPRForIssue(issueKey: string): Promise<PullRequest | null> {
    const parsed = this.github.parseIssueKey(issueKey);
    if (!parsed) return null;

    const prs = await this.github.fetchOpenPRs(parsed.owner, parsed.repo);
    for (const pr of prs) {
      const linkedIssues = this.github.extractLinkedIssueNumbers(pr.body);
      if (linkedIssues.has(parsed.number)) {
        return pr;
      }
    }
    return null;
  }

  private async dispatchReview(pr: PullRequest): Promise<void> {
    const prRunKey = `pr-agent-review:${pr.key}`;
    if (this.state.isRunning(prRunKey)) return;

    const runId = ulid();
    const abortController = new AbortController();

    await this.github.addLabel(pr.owner, pr.repo, pr.number, this.config.labels.needsReview);

    const diff = await this.github.fetchPRDiff(pr.owner, pr.repo, pr.number);
    const prompt = this.dispatcher.buildReviewDispatchPrompt(pr, diff);

    const entry: RunEntry = {
      runId,
      issueKey: prRunKey,
      provider: this.config.prReview.provider,
      model: this.config.prReview.model,
      startedAt: new Date(),
      lastActivity: new Date(),
      retryCount: 0,
      abortController,
      currentAgent: "pr-reviewer",
      lastActivityDescription: "Starting review...",
      toolCallCount: 0,
    };

    this.state.add(prRunKey, entry);
    this.logger.info({ runId, prKey: pr.key }, "dispatching PR review agent");

    this.deps.runsRepo?.insert({
      id: runId,
      issueKey: prRunKey,
      provider: entry.provider,
      model: entry.model,
      status: "running",
      startedAt: entry.startedAt.toISOString(),
      retryCount: 0,
    });

    this.sseHub.broadcast("agent:started", { runId, issueKey: prRunKey, provider: entry.provider });

    const workDir = this.deps.workspace?.ensure(prRunKey);

    const { submitReview, getVerdict } = createReviewTools();
    this.reviewVerdicts.set(prRunKey, getVerdict);

    this.executeReviewAgentRun(runId, prRunKey, pr, prompt, abortController, submitReview, workDir).catch((err) => {
      this.logger.error({ err, runId, prKey: pr.key }, "unhandled review agent error");
    });
  }

  private async executeReviewAgentRun(
    runId: string,
    prRunKey: string,
    pr: PullRequest,
    prompt: string,
    abortController: AbortController,
    submitReview: ReturnType<typeof createReviewTools>["submitReview"],
    workDir?: string,
  ): Promise<void> {
    const stallDetector = createStallDetector(this.config.agent.stallTimeout, () => {
      this.logger.warn({ runId, prRunKey }, "review agent stalled, aborting");
      abortController.abort();
    });

    try {
      const runConfig: RunConfig = {
        provider: this.config.prReview.provider as any,
        agent: {
          ...prReviewerAgent,
          tools: [submitReview],
        } as any,
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
        this.state.updateActivity(prRunKey);

        const entry = this.state.get(prRunKey);
        if (entry) {
          if (chunk.type === "tool_call") {
            const toolChunk = chunk as unknown as { toolName?: string };
            entry.lastActivityDescription = `Called ${toolChunk.toolName ?? "unknown"}`;
            entry.toolCallCount++;
          } else if (chunk.type === "text") {
            const textChunk = chunk as unknown as { content?: string };
            const content = textChunk.content ?? "";
            entry.lastActivityDescription = content.length > 80 ? content.slice(0, 80) : (content || "Reviewing...");
          }
        }

        this.sseHub.broadcast(`agent:${chunk.type}`, { runId, ...chunk });

        this.deps.eventsRepo?.insert(runId, chunk.type, chunk as unknown as Record<string, unknown>);

        if (chunk.type === "done" && chunk.usage) {
          totalInputTokens += chunk.usage.inputTokens;
          totalOutputTokens += chunk.usage.outputTokens;
        }
      }

      stallDetector.stop();

      const durationMs = Date.now() - (this.state.get(prRunKey)?.startedAt.getTime() ?? Date.now());
      this.state.remove(prRunKey);
      this.deps.runsRepo?.completeRun(runId, "completed", new Date().toISOString(), durationMs);
      this.logger.info({ runId, prRunKey, durationMs }, "review agent run completed");

      if (totalInputTokens > 0 || totalOutputTokens > 0) {
        this.deps.metricsRepo?.record({
          runId,
          provider: this.config.prReview.provider,
          tokensIn: totalInputTokens,
          tokensOut: totalOutputTokens,
          durationMs,
        });
      }

      this.sseHub.broadcast("agent:completed", { runId, issueKey: prRunKey });

      await this.onReviewComplete(pr);

    } catch (err) {
      stallDetector.stop();
      this.state.remove(prRunKey);
      this.reviewVerdicts.delete(prRunKey);

      const errorMsg = err instanceof Error ? err.message : String(err);
      this.deps.runsRepo?.completeRun(runId, "failed", new Date().toISOString(), 0, errorMsg);
      this.logger.error({ err, runId, prRunKey }, "review agent run failed");

      await this.github.removeLabel(pr.owner, pr.repo, pr.number, this.config.labels.needsReview);

      this.sseHub.broadcast("agent:failed", { runId, issueKey: prRunKey, error: errorMsg });
    }
  }

  private async onReviewComplete(pr: PullRequest): Promise<void> {
    const prRunKey = `pr-agent-review:${pr.key}`;
    await this.github.removeLabel(pr.owner, pr.repo, pr.number, this.config.labels.needsReview);

    const getVerdict = this.reviewVerdicts.get(prRunKey);
    const verdict = getVerdict?.() ?? null;
    this.reviewVerdicts.delete(prRunKey);

    if (!verdict) {
      this.logger.warn({ prKey: pr.key }, "review agent did not submit a verdict, treating as implicit approval (no auto-merge)");
      this.reviewCycles.reset(pr.key);
    } else if (verdict.verdict === "approve") {
      this.logger.info({ prKey: pr.key }, "PR approved by review agent");
      this.reviewCycles.reset(pr.key);

      await this.github.addComment(pr.owner, pr.repo, pr.number, verdict.summary);

      if (this.config.prReview.autoMerge) {
        await this.tryAutoMerge(pr);
      }
    } else if (verdict.verdict === "request_changes") {
      // Submit as COMMENT review (not REQUEST_CHANGES) with inline comments
      await this.github.submitPRReview(
        pr.owner,
        pr.repo,
        pr.number,
        "COMMENT",
        verdict.summary,
        verdict.comments,
      );

      this.reviewCycles.increment(pr.key);
      const cycleCount = this.reviewCycles.getCycleCount(pr.key);

      if (this.reviewCycles.isExhausted(pr.key, this.config.prReview.maxReviewCycles)) {
        this.logger.warn({ prKey: pr.key, cycleCount }, "max review cycles reached, escalating to human");
        await this.github.addLabel(pr.owner, pr.repo, pr.number, this.config.labels.needsHuman);
        this.reviewCycles.reset(pr.key);
      } else {
        this.logger.info({ prKey: pr.key, cycleCount }, "review requested changes, waiting for coder to address");
        await this.github.addLabel(pr.owner, pr.repo, pr.number, this.config.labels.inProgress);
      }
    }
  }

  private async tryAutoMerge(pr: PullRequest): Promise<void> {
    if (!this.config.prReview.requireChecks) {
      await this.github.mergePR(pr.owner, pr.repo, pr.number);
      this.logger.info({ prKey: pr.key }, "auto-merged PR (checks not required)");
      return;
    }

    const passed = await this.github.allChecksPassed(pr.owner, pr.repo, pr.headRef);
    if (passed) {
      await this.github.mergePR(pr.owner, pr.repo, pr.number);
      this.logger.info({ prKey: pr.key }, "auto-merged PR (all checks passed)");
    } else {
      this.logger.info({ prKey: pr.key }, "skipping auto-merge: CI checks not all passing");
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

  async rebaseConflictingPRs(owner: string, repo: string): Promise<void> {
    const token = this.config.github.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      this.logger.warn("no GitHub token available, skipping rebase of conflicting PRs");
      return;
    }

    const prs = await this.github.fetchOpenPRs(owner, repo);
    this.logger.info({ owner, repo, prCount: prs.length }, "checking open PRs for merge conflicts");

    for (const pr of prs) {
      const { mergeable } = await this.github.fetchPRMergeableStatus(owner, repo, pr.number);

      // mergeable === false means there are conflicts
      if (mergeable !== false) continue;

      this.logger.info({ owner, repo, prNumber: pr.number, branch: pr.headRef }, "rebasing conflicting PR");

      const tmpDir = `/tmp/rebase-${owner}-${repo}-${pr.number}-${Date.now()}`;
      try {
        mkdirSync(tmpDir, { recursive: true });
        const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

        await execFile("git", ["clone", "--branch", pr.headRef, "--single-branch", cloneUrl, tmpDir]);
        await execFile("git", ["fetch", "origin", "main"], { cwd: tmpDir });

        try {
          await execFile("git", ["rebase", "origin/main"], { cwd: tmpDir });
        } catch {
          // Rebase failed — abort and comment
          this.logger.warn({ owner, repo, prNumber: pr.number }, "rebase failed, aborting");
          await execFile("git", ["rebase", "--abort"], { cwd: tmpDir }).catch(() => {});
          await this.github.addComment(
            owner,
            repo,
            pr.number,
            `Automatic rebase onto \`main\` failed due to conflicts. Please rebase manually.`,
          );
          continue;
        }

        await execFile("git", ["push", "--force-with-lease"], { cwd: tmpDir });
        this.logger.info({ owner, repo, prNumber: pr.number }, "successfully rebased and pushed PR");
      } finally {
        // Clean up workspace
        try {
          rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          this.logger.warn({ tmpDir }, "failed to clean up rebase workspace");
        }
      }
    }
  }
}
