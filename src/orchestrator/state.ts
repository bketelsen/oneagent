export interface RunEntry {
  runId: string;
  issueKey: string;
  provider: string;
  model?: string;
  startedAt: Date;
  lastActivity: Date;
  retryCount: number;
  abortController?: AbortController;
}

export class RunState {
  private runs = new Map<string, RunEntry>();

  add(issueKey: string, entry: RunEntry): void {
    this.runs.set(issueKey, entry);
  }

  remove(issueKey: string): RunEntry | undefined {
    const entry = this.runs.get(issueKey);
    this.runs.delete(issueKey);
    return entry;
  }

  get(issueKey: string): RunEntry | undefined {
    return this.runs.get(issueKey);
  }

  isRunning(issueKey: string): boolean {
    return this.runs.has(issueKey);
  }

  activeCount(): number {
    return this.runs.size;
  }

  running(): IterableIterator<[string, RunEntry]> {
    return this.runs.entries();
  }

  updateActivity(issueKey: string): void {
    const entry = this.runs.get(issueKey);
    if (entry) entry.lastActivity = new Date();
  }
}
