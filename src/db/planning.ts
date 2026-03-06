import type Database from "better-sqlite3";

export interface PlanningMessage {
  role: string;
  content: string;
}

export interface PlanningSessionRow {
  id: string;
  issueKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export class PlanningRepo {
  constructor(private db: Database.Database) {}

  save(id: string, history: PlanningMessage[], issueKey?: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO planning_sessions (id, issue_key, created_at, updated_at, history)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET history = ?, updated_at = ?
    `).run(id, issueKey ?? null, now, now, JSON.stringify(history), JSON.stringify(history), now);
  }

  load(id: string): PlanningMessage[] {
    const row = this.db.prepare("SELECT history FROM planning_sessions WHERE id = ?").get(id) as any;
    return row ? JSON.parse(row.history) : [];
  }

  list(): PlanningSessionRow[] {
    return (this.db.prepare("SELECT id, issue_key, created_at, updated_at FROM planning_sessions ORDER BY updated_at DESC").all() as any[]).map((r) => ({
      id: r.id,
      issueKey: r.issue_key,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }
}
