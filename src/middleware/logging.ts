import type { Logger } from "pino";
import type { StreamChunkLike } from "./event-bridge.js";

export function logChunk(chunk: StreamChunkLike, runId: string, logger: Logger): void {
  logger.debug({ runId, chunkType: chunk.type }, "agent chunk");
}
