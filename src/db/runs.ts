import type Database from "better-sqlite3";

export interface RunRow {
  id: string;
  issueKey: string;
  provider: string;
  model?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
  error?: string;
  tokenUsage?: string;
}

export interface DurationStats {
  count: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

export class RunsRepo {
  constructor(private db: Database.Database) {}

  insert(run: RunRow): void {
    this.db.prepare(`
      INSERT INTO runs (id, issue_key, provider, model, status, started_at, retry_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(run.id, run.issueKey, run.provider, run.model ?? null, run.status, run.startedAt, run.retryCount);
  }

  updateStatus(id: string, status: string, finishedAt?: string, error?: string): void {
    this.db.prepare(`
      UPDATE runs SET status = ?, finished_at = ?, error = ? WHERE id = ?
    `).run(status, finishedAt ?? null, error ?? null, id);
  }

  completeRun(id: string, status: string, completedAt: string, error?: string): void {
    // Look up the run to compute duration from started_at
    const run = this.getById(id);
    let durationMs: number | null = null;
    if (run) {
      durationMs = new Date(completedAt).getTime() - new Date(run.startedAt).getTime();
    }
    this.db.prepare(`
      UPDATE runs SET status = ?, completed_at = ?, duration_ms = ?, finished_at = ?, error = ? WHERE id = ?
    `).run(status, completedAt, durationMs, completedAt, error ?? null, id);
  }

  getDurationStats(limit: number): DurationStats | undefined {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as count,
        AVG(duration_ms) as avg_ms,
        MIN(duration_ms) as min_ms,
        MAX(duration_ms) as max_ms
      FROM (
        SELECT duration_ms FROM runs
        WHERE duration_ms IS NOT NULL
        ORDER BY completed_at DESC
        LIMIT ?
      )
    `).get(limit) as any;

    if (!row || row.count === 0) {
      return undefined;
    }

    return {
      count: row.count,
      avgMs: Math.round(row.avg_ms),
      minMs: row.min_ms,
      maxMs: row.max_ms,
    };
  }

  getById(id: string): RunRow | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as any;
    return row ? this.mapRow(row) : undefined;
  }

  listByIssue(issueKey: string): RunRow[] {
    return (this.db.prepare("SELECT * FROM runs WHERE issue_key = ? ORDER BY started_at DESC").all(issueKey) as any[]).map(this.mapRow);
  }

  private mapRow(row: any): RunRow {
    return {
      id: row.id,
      issueKey: row.issue_key,
      provider: row.provider,
      model: row.model,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      retryCount: row.retry_count,
      error: row.error,
      tokenUsage: row.token_usage,
    };
  }
}
