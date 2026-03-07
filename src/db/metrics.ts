import type Database from "better-sqlite3";

export interface MetricRecord {
  runId?: string;
  provider: string;
  model?: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export class MetricsRepo {
  constructor(private db: Database.Database) {}

  record(m: MetricRecord): void {
    this.db.prepare(`
      INSERT INTO metrics (run_id, provider, model, tokens_in, tokens_out, duration_ms, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(m.runId ?? null, m.provider, m.model ?? null, m.tokensIn, m.tokensOut, m.durationMs, new Date().toISOString());
  }

  totals(): { tokensIn: number; tokensOut: number; runs: number } {
    const row = this.db.prepare(
      "SELECT COALESCE(SUM(tokens_in),0) as ti, COALESCE(SUM(tokens_out),0) as to_, COUNT(*) as c FROM metrics"
    ).get() as any;
    return { tokensIn: row.ti, tokensOut: row.to_, runs: row.c };
  }

  tokensByRun(runId: string): { tokensIn: number; tokensOut: number } {
    const row = this.db.prepare(
      "SELECT COALESCE(SUM(tokens_in),0) as ti, COALESCE(SUM(tokens_out),0) as to_ FROM metrics WHERE run_id = ?"
    ).get(runId) as any;
    return { tokensIn: row.ti, tokensOut: row.to_ };
  }
}
