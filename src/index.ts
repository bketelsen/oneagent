#!/usr/bin/env node
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: ".env.local" });
loadDotenv({ path: ".env" });

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, watchFile, unwatchFile } from "node:fs";
import { ConfigWatcher } from "./config/watcher.js";
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
import { createPlanningTools } from "./tools/planning.js";
import { createPlannerAgent } from "./agents/planner.js";
import { run } from "one-agent-sdk";
import { cloneAndCapture } from "./tools/clone-and-capture.js";

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
    const workspace = new WorkspaceManager(config.workspace.baseDir, logger, config.workspace.hooks);
    const sseHub = new SSEHub();

    const orchestrator = new Orchestrator(config, github, {
      config, github, runsRepo, eventsRepo, metricsRepo, workspace, logger,
    });

    const configWatcher = new ConfigWatcher((newConfig) => {
      orchestrator.reloadConfig(newConfig);
    }, logger);

    watchFile(opts.config, { interval: 5000 }, () => {
      try {
        const newYaml = readFileSync(opts.config, "utf-8");
        configWatcher.handleFileChange(newYaml);
      } catch (err) {
        logger.error({ err }, "failed to read config file on change");
      }
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
            retryCount: r.retryCount,
            lastError: r.error ?? eventsRepo.getLastError(r.id),
          })),
        runsRepo,
      };

      const app = createApp({
        app: appCtx,
        sprint: {
          getBoard: async () => {
            const todo: Array<{ key: string; title: string }> = [];
            const inProgress: Array<{ key: string; title: string }> = [];
            const inReview: Array<{ key: string; title: string }> = [];
            const done: Array<{ key: string; title: string }> = [];

            const since = new Date();
            since.setDate(since.getDate() - 30);

            for (const repo of config.github.repos) {
              const [openIssues, closedIssues] = await Promise.all([
                github.fetchIssues(repo.owner, repo.repo, config.labels.eligible),
                github.fetchClosedIssues(repo.owner, repo.repo, since),
              ]);

              for (const issue of openIssues) {
                if (orchestrator.state.isRunning(issue.key)) {
                  inProgress.push({ key: issue.key, title: issue.title });
                } else if (issue.hasOpenPR) {
                  inReview.push({ key: issue.key, title: issue.title });
                } else {
                  todo.push({ key: issue.key, title: issue.title });
                }
              }

              for (const issue of closedIssues) {
                const runs = runsRepo.listByIssue(issue.key);
                if (runs.some((r) => r.status === "completed")) {
                  done.push({ key: issue.key, title: issue.title });
                }
              }
            }

            return { todo, inProgress, inReview, done };
          },
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
          repos: config.github.repos.map((r) => ({ owner: r.owner, repo: r.repo })),
          onCreate: async (sessionId: string, owner: string, repo: string) => {
            try {
              const githubToken = config.github.token ?? process.env.GITHUB_TOKEN;
              const context = await cloneAndCapture(owner, repo, githubToken);
              planningRepo.saveContext(sessionId, context);
              logger.info({ sessionId, repo: `${owner}/${repo}` }, "Captured repo context for planning session");
            } catch (err) {
              logger.error({ sessionId, err }, "Failed to capture repo context");
            }
          },
          onChat: async function* (sessionId: string, message: string) {
            // Determine which repo this session targets
            const session = planningRepo.getSession(sessionId);
            const repoStr = session?.repo || `${config.github.repos[0].owner}/${config.github.repos[0].repo}`;
            const [owner, repoName] = repoStr.split("/");
            const repoConfig = config.github.repos.find((r) => r.owner === owner && r.repo === repoName) ?? config.github.repos[0];

            const planningTools = createPlanningTools({
              planningRepo,
              repoConfig,
            });
            const agent = createPlannerAgent([
              planningTools.createPlan,
              planningTools.refinePlan,
              planningTools.publishPlan,
            ]);

            // Load history and repo context
            const history = planningRepo.load(sessionId);
            const historyText = history
              .map((m) => `${m.role}: ${m.content}`)
              .join("\n\n");
            const repoContext = planningRepo.loadContext(sessionId);

            // Build prompt with repo context injected
            let prompt = agent.prompt;
            if (repoContext) {
              prompt += `\n\n## Repository Context for ${repoStr}\n\n${repoContext}`;
            }
            prompt += `\n\nIMPORTANT: The current planning session ID is "${sessionId}". Always use this sessionId when calling create_plan, refine_plan, or publish_plan.`;
            if (historyText) {
              prompt += `\n\nConversation history:\n${historyText}`;
            }
            prompt += `\n\nUser: ${message}`;

            const agentRun = await run(prompt, {
              provider: config.agent.provider,
              agent: agent as any,
            });

            let fullResponse = "";
            for await (const chunk of agentRun.stream) {
              if (chunk.type === "text") {
                fullResponse += chunk.text;
                yield chunk.text;
              }
            }
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
      unwatchFile(opts.config);
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
