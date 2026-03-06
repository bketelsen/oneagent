import { Hono } from "hono";
import type { Logger } from "pino";
import { apiRoutes, type AppContext } from "./routes/api.js";
import { dashboardRoute } from "./routes/dashboard.js";
import { sprintRoute, type SprintContext } from "./routes/sprint.js";
import { issuesRoute, type IssuesContext } from "./routes/issues.js";
import { settingsRoute } from "./routes/settings.js";
import { planningRoute, type PlanningContext } from "./routes/planning.js";
import { requestLogger } from "../middleware/request-logger.js";
import type { Config } from "../config/schema.js";

export interface FullAppContext {
  app: AppContext;
  sprint?: SprintContext;
  issues?: IssuesContext;
  planning?: PlanningContext;
  getConfig?: () => Config;
  logger?: Logger;
}

export function createApp(ctx: AppContext | FullAppContext): Hono {
  const app = new Hono();

  // Determine if this is a full context or simple context
  const isFullCtx = "app" in ctx;
  const appCtx = isFullCtx ? ctx.app : ctx;

  if (isFullCtx && ctx.logger) {
    app.use("*", requestLogger(ctx.logger));
  }

  app.route("/api/v1", apiRoutes(appCtx));
  app.route("/", dashboardRoute(appCtx));

  if (isFullCtx && ctx.sprint) {
    app.route("/sprint", sprintRoute(ctx.sprint));
  }

  if (isFullCtx && ctx.issues) {
    app.route("/issues", issuesRoute(ctx.issues));
  }

  if (isFullCtx && ctx.planning) {
    app.route("/planning", planningRoute(ctx.planning));
  }

  if (isFullCtx && ctx.getConfig) {
    app.route("/settings", settingsRoute(ctx.getConfig));
  }

  return app;
}
