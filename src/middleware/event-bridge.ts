import type { EventEmitter } from "node:events";
import type { RunEventsRepo } from "../db/run-events.js";

export interface StreamChunkLike {
  type: string;
  [key: string]: unknown;
}

export function bridgeChunkToSSE(
  chunk: StreamChunkLike,
  runId: string,
  sseHub: EventEmitter,
  eventsRepo?: RunEventsRepo,
): void {
  const eventType = `agent:${chunk.type}`;
  sseHub.emit("sse", { type: eventType, data: { runId, ...chunk } });
  eventsRepo?.insert(runId, chunk.type, chunk as Record<string, unknown>);
}
