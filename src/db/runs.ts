import type Database from "better-sqlite3";

export interface RunRow {
  id: string;
  issueKey: string;
  provider: string;
  model?: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  retryCount: number;
  error?: string;
  tokenUsage?: string;
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

  private mapRow(row: any): RunRow {
    return {
      id: row.id,
      issueKey: row.issue_key,
      provider: row.provider,
      model: row.model,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      retryCount: row.retry_count,
      error: row.error,
      tokenUsage: row.token_usage,
    };
  }
}
