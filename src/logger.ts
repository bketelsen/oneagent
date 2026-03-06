import pino, { type Logger } from "pino";

export type { Logger } from "pino";

export interface LoggerOptions {
  level: string;
  logFile?: string;
}

export function createLogger(opts: LoggerOptions): Logger {
  const isDev = process.env.NODE_ENV !== "production";

  if (opts.logFile) {
    return pino({
      level: opts.level,
      transport: { target: "pino/file", options: { destination: opts.logFile } },
    });
  }

  if (isDev) {
    return pino({
      level: opts.level,
      transport: { target: "pino-pretty" },
    });
  }

  return pino({ level: opts.level });
}
