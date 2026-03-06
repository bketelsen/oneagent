import type { MiddlewareHandler } from "hono";
import type { Logger } from "pino";

export function requestLogger(logger: Logger): MiddlewareHandler {
  const httpLogger = logger.child({ module: "http" });
  return async (c, next) => {
    const start = Date.now();
    await next();
    const durationMs = Date.now() - start;
    httpLogger.info({
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
    }, "request");
  };
}
