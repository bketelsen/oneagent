import type { Logger } from "pino";
import type { StreamChunkLike } from "./event-bridge.js";

export function logChunk(chunk: StreamChunkLike, runId: string, logger: Logger): void {
  logger.debug({ runId, chunkType: chunk.type }, "agent chunk");
}

export interface HandoffEvent {
  event: "agent.handoff";
  from: string;
  to: string;
  runId: string;
  issueNumber: number;
  timestamp: string;
}

export function logHandoff(
  from: string,
  to: string,
  runId: string,
  issueNumber: number,
  logger: Logger,
): void {
  const payload: HandoffEvent = {
    event: "agent.handoff",
    from,
    to,
    runId,
    issueNumber,
    timestamp: new Date().toISOString(),
  };
  logger.info(payload, "agent.handoff");
}
