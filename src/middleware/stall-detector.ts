export interface StallDetector {
  start(): void;
  stop(): void;
  activity(): void;
}

export function createStallDetector(
  timeoutMs: number,
  onStall: () => void,
): StallDetector {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    start() {
      timer = setTimeout(onStall, timeoutMs);
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    activity() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onStall, timeoutMs);
    },
  };
}
