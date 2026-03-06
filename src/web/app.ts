import { Hono } from "hono";
import { apiRoutes, type AppContext } from "./routes/api.js";

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();
  app.route("/api/v1", apiRoutes(ctx));
  return app;
}
