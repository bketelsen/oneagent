import type Database from "better-sqlite3";

export interface RunRow {
  id: string;
  issueKey: string;
  provider: string;
  model?: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  retryCount: number;
  error?: string;
  tokenUsage?: string;
}

export interface DurationStats {
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  totalRuns: number;
}

export interface StatusCounts {
  total: number;
  completed: number;
  failed: number;
  running: number;
}

export class RunsRepo {
  constructor(private db: Database.Database) {}

  insert(run: RunRow): void {
    this.db.prepare(`
      INSERT INTO runs (id, issue_key, provider, model, status, started_at, retry_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(run.id, run.issueKey, run.provider, run.model ?? null, run.status, run.startedAt, run.retryCount);
  }

  updateStatus(id: string, status: string, completedAt?: string, error?: string): void {
    this.db.prepare(`
      UPDATE runs SET status = ?, completed_at = ?, error = ? WHERE id = ?
    `).run(status, completedAt ?? null, error ?? null, id);
  }

  completeRun(id: string, status: string, completedAt: string, durationMs: number, error?: string): void {
    this.db.prepare(`
      UPDATE runs SET status = ?, completed_at = ?, duration_ms = ?, error = ? WHERE id = ?
    `).run(status, completedAt, durationMs, error ?? null, id);
  }

  getDurationStats(): DurationStats {
    const row = this.db.prepare(`
      SELECT
        COALESCE(AVG(duration_ms), 0) as avg_duration,
        COALESCE(MIN(duration_ms), 0) as min_duration,
        COALESCE(MAX(duration_ms), 0) as max_duration,
        COUNT(*) as total_runs
      FROM runs
      WHERE duration_ms IS NOT NULL
    `).get() as any;
    return {
      avgDurationMs: row.avg_duration,
      minDurationMs: row.min_duration,
      maxDurationMs: row.max_duration,
      totalRuns: row.total_runs,
    };
  }

  getStatusCounts(): StatusCounts {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
        COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) as running
      FROM runs
    `).get() as any;
    return {
      total: row.total,
      completed: row.completed,
      failed: row.failed,
      running: row.running,
    };
  }

  getById(id: string): RunRow | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as any;
    return row ? this.mapRow(row) : undefined;
  }

  listByIssue(issueKey: string): RunRow[] {
    return (this.db.prepare("SELECT * FROM runs WHERE issue_key = ? ORDER BY started_at DESC").all(issueKey) as any[]).map(this.mapRow);
  }

  listAll(limit = 50): RunRow[] {
    return (this.db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?").all(limit) as any[]).map(this.mapRow);
  }

  /**
   * Return all runs in non-terminal status (running / completed) that may
   * need reconciliation against the actual GitHub state.
   *
   * "completed" is included because a run may be marked completed in the DB
   * before the orchestrator has verified the issue/PR state on GitHub (e.g.
   * the process restarted mid-cleanup), so it still needs reconciliation.
   */
  listNonTerminal(): RunRow[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM runs WHERE status IN ('running', 'completed') ORDER BY started_at DESC",
        )
        .all() as any[]
    ).map(this.mapRow);
  }

  private mapRow(row: any): RunRow {
    return {
      id: row.id,
      issueKey: row.issue_key,
      provider: row.provider,
      model: row.model ?? undefined,
      status: row.status,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      retryCount: row.retry_count,
      error: row.error ?? undefined,
      tokenUsage: row.token_usage ?? undefined,
    };
  }
}
