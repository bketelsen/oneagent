interface RetryEntry {
  issueKey: string;
  retryCount: number;
  nextAttempt: number;
}

export class RetryQueue {
  private queue = new Map<string, RetryEntry>();

  constructor(
    private baseDelayMs: number,
    private maxRetries: number,
  ) {}

  enqueue(issueKey: string, retryCount: number): void {
    const delay = this.baseDelayMs * Math.pow(2, retryCount);
    this.queue.set(issueKey, {
      issueKey,
      retryCount: retryCount + 1,
      nextAttempt: Date.now() + delay,
    });
  }

  dequeue(issueKey: string): void {
    this.queue.delete(issueKey);
  }

  due(): string[] {
    const now = Date.now();
    return [...this.queue.values()]
      .filter((e) => e.nextAttempt <= now)
      .map((e) => e.issueKey);
  }

  getRetryCount(issueKey: string): number {
    return this.queue.get(issueKey)?.retryCount ?? 0;
  }

  canRetry(retryCount: number): boolean {
    return retryCount < this.maxRetries;
  }

  size(): number {
    return this.queue.size;
  }
}
