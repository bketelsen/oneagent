import type { SSEHub } from "../web/sse.js";
import type { RunEventsRepo } from "../db/run-events.js";

export interface StreamChunkLike {
  type: string;
  [key: string]: unknown;
}

export function bridgeChunkToSSE(
  chunk: StreamChunkLike,
  runId: string,
  sseHub: SSEHub,
  eventsRepo?: RunEventsRepo,
): void {
  const eventType = `agent:${chunk.type}`;
  sseHub.broadcast(eventType, { runId, ...chunk });
  eventsRepo?.insert(runId, chunk.type, chunk as Record<string, unknown>);
}
