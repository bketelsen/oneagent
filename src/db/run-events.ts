import type Database from "better-sqlite3";

export interface RunEventRow {
  id: number;
  runId: string;
  type: string;
  payload: Record<string, unknown>;
  ts: string;
}

export class RunEventsRepo {
  constructor(private db: Database.Database) {}

  insert(runId: string, type: string, payload: Record<string, unknown>): void {
    this.db.prepare(
      "INSERT INTO run_events (run_id, type, payload, ts) VALUES (?, ?, ?, ?)"
    ).run(runId, type, JSON.stringify(payload), new Date().toISOString());
  }

  getLastError(runId: string): string | undefined {
    const row = this.db.prepare(
      "SELECT payload FROM run_events WHERE run_id = ? AND type = 'error' ORDER BY id DESC LIMIT 1"
    ).get(runId) as any;
    if (!row) return undefined;
    const parsed = JSON.parse(row.payload);
    return parsed.message ?? JSON.stringify(parsed);
  }

  listByRun(runId: string): RunEventRow[] {
    return (this.db.prepare("SELECT * FROM run_events WHERE run_id = ? ORDER BY id").all(runId) as any[]).map((r) => ({
      id: r.id,
      runId: r.run_id,
      type: r.type,
      payload: JSON.parse(r.payload),
      ts: r.ts,
    }));
  }
}
