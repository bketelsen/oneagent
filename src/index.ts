#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadConfigFromString } from "./config/loader.js";
import { DEFAULT_CONFIG_PATH } from "./config/defaults.js";
import { createDatabase } from "./db/index.js";
import { RunsRepo } from "./db/runs.js";
import { RunEventsRepo } from "./db/run-events.js";
import { MetricsRepo } from "./db/metrics.js";
import { PlanningRepo } from "./db/planning.js";
import { GitHubClient } from "./github/client.js";
import { Orchestrator } from "./orchestrator/orchestrator.js";
import { WorkspaceManager } from "./workspace/manager.js";
import { SSEHub } from "./web/sse.js";
import { createApp } from "./web/app.js";
import { serve } from "@hono/node-server";
import { createLogger } from "./logger.js";

const program = new Command();
program.name("oneagent").description("AI agent orchestrator for GitHub issues").version("0.1.0");

program
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .option("-p, --port <number>", "dashboard port")
  .option("--dry-run", "list eligible issues without dispatching")
  .option("--debug", "enable debug logging")
  .option("--log <path>", "log file path")
  .action(async (opts) => {
    const logger = createLogger({
      level: opts.debug ? "debug" : "info",
      logFile: opts.log,
    });

    if (!existsSync(opts.config)) {
      logger.error(`Config file not found: ${opts.config}`);
      process.exit(1);
    }

    const configYaml = readFileSync(opts.config, "utf-8");
    const config = loadConfigFromString(configYaml);

    if (opts.port) config.web.port = parseInt(opts.port, 10);

    const token = config.github.token ?? process.env.GITHUB_TOKEN;
    if (!token) {
      logger.error("No GitHub token found. Set GITHUB_TOKEN or configure github.token in config.");
      process.exit(1);
    }

    const db = createDatabase("oneagent.db");
    const runsRepo = new RunsRepo(db);
    const eventsRepo = new RunEventsRepo(db);
    const metricsRepo = new MetricsRepo(db);
    const planningRepo = new PlanningRepo(db);
    const github = new GitHubClient(token, logger);
    const workspace = new WorkspaceManager(config.workspace.baseDir, logger);
    const sseHub = new SSEHub();

    const orchestrator = new Orchestrator(config, github, {
      config, github, runsRepo, eventsRepo, metricsRepo, workspace, logger, sseHub,
    });

    if (opts.dryRun) {
      logger.info("Dry run — fetching eligible issues...");
      await orchestrator.tick();
      process.exit(0);
    }

    if (config.web.enabled) {
      const appCtx = {
        sseHub,
        onRefresh: () => orchestrator.tick(),
        getState: () => ({
          running: [...orchestrator.state.running()].map(([, e]) => ({
            runId: e.runId,
            issueKey: e.issueKey,
            provider: e.provider,
            currentAgent: e.currentAgent,
            lastActivityDescription: e.lastActivityDescription,
            toolCallCount: e.toolCallCount,
            startedAt: e.startedAt.toISOString(),
          })),
          retryQueue: [],
          metrics: metricsRepo.totals(),
        }),
        getRecentRuns: () =>
          runsRepo.listAll(50).map((r) => ({
            id: r.id,
            issueKey: r.issueKey,
            provider: r.provider,
            status: r.status,
            startedAt: r.startedAt,
            completedAt: r.completedAt,
            durationMs: r.durationMs,
            retryCount: r.retryCount,
            lastError: r.error ?? eventsRepo.getLastError(r.id),
          })),
        runsRepo,
        cancelRun: (runId: string) => {
          const entry = orchestrator.state.get(runId);
          if (!entry?.abortController) return false;
          entry.abortController.abort();
          return true;
        },
      };

      const app = createApp({
        app: appCtx,
        sprint: {
          getBoard: async () => ({ todo: [], inProgress: [], inReview: [], done: [] }),
        },
        issues: {
          getRunEvents: (issueKey) => {
            const runs = runsRepo.listByIssue(issueKey);
            if (runs.length === 0) return [];
            return eventsRepo.listByRun(runs[0].id);
          },
          getRunHistory: (issueKey) =>
            runsRepo.listByIssue(issueKey).map((r) => ({
              id: r.id, status: r.status, startedAt: r.startedAt, provider: r.provider,
            })),
        },
        runs: {
          runsRepo,
          eventsRepo,
        },
        planning: {
          planningRepo,
          onChat: async function* (_sessionId: string, _message: string) {
            yield "Planning agent not yet connected";
          },
        },
        getConfig: () => config,
        logger,
      });

      serve({ fetch: app.fetch, port: config.web.port }, (info) => {
        logger.info(`Dashboard running at http://localhost:${info.port}`);
      });
    }

    orchestrator.start();
    logger.info("Orchestrator started");

    const shutdown = () => {
      logger.info("Shutting down...");
      orchestrator.stop();
      db.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });

program
  .command("init")
  .description("create default config file")
  .action(() => {
    if (existsSync(DEFAULT_CONFIG_PATH)) {
      console.error(`${DEFAULT_CONFIG_PATH} already exists`);
      process.exit(1);
    }
    writeFileSync(DEFAULT_CONFIG_PATH, `github:
  repos:
    - owner: your-org
      repo: your-repo
      labels: [oneagent]

agent:
  provider: claude-code

web:
  port: 3000
`);
    console.log(`Created ${DEFAULT_CONFIG_PATH}`);
  });

program
  .command("setup")
  .description("create required GitHub labels on configured repos")
  .option("-c, --config <path>", "config file path", DEFAULT_CONFIG_PATH)
  .action(async (opts) => {
    const configYaml = readFileSync(opts.config, "utf-8");
    const config = loadConfigFromString(configYaml);
    const token = config.github.token ?? process.env.GITHUB_TOKEN;
    if (!token) { console.error("No GitHub token"); process.exit(1); }
    const github = new GitHubClient(token);
    for (const repo of config.github.repos) {
      for (const label of [config.labels.eligible, config.labels.inProgress, config.labels.failed]) {
        try {
          await github.addLabel(repo.owner, repo.repo, 0, label);
          console.log(`Created label "${label}" on ${repo.owner}/${repo.repo}`);
        } catch {
          console.log(`Label "${label}" may already exist on ${repo.owner}/${repo.repo}`);
        }
      }
    }
  });

program.parse();
