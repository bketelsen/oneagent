import { Hono } from "hono";

const startTime = Date.now();

const VERSION = "0.1.0";

export function healthRoute(): Hono {
  const route = new Hono();

  route.get("/health", (c) => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    return c.json({
      status: "ok",
      uptime: uptimeSeconds,
      version: VERSION,
    });
  });

  return route;
}
