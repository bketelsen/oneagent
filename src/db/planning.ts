import type Database from "better-sqlite3";

export interface PlanningMessage {
  role: string;
  content: string;
}

export interface PlanTask {
  id: string;
  title: string;
  body: string;
  complexity: "low" | "medium" | "high";
  dependsOn: string[];
  acceptanceCriteria: string[];
  issueNumber?: number;
}

export interface PlanPhase {
  name: string;
  tasks: PlanTask[];
}

export interface Plan {
  title: string;
  description: string;
  phases: PlanPhase[];
  status: "draft" | "approved" | "published";
}

export interface PlanningSessionRow {
  id: string;
  issueKey: string | null;
  status: string | null;
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
    return (this.db.prepare("SELECT id, issue_key, status, created_at, updated_at FROM planning_sessions ORDER BY updated_at DESC").all() as any[]).map((r) => ({
      id: r.id,
      issueKey: r.issue_key,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  savePlan(id: string, plan: Plan): void {
    const now = new Date().toISOString();
    const planJson = JSON.stringify(plan);
    this.db.prepare(`
      INSERT INTO planning_sessions (id, created_at, updated_at, history, plan, status)
      VALUES (?, ?, ?, '[]', ?, ?)
      ON CONFLICT(id) DO UPDATE SET plan = ?, status = ?, updated_at = ?
    `).run(id, now, now, planJson, plan.status, planJson, plan.status, now);
  }

  loadPlan(id: string): Plan | null {
    const row = this.db.prepare("SELECT plan FROM planning_sessions WHERE id = ?").get(id) as any;
    if (!row?.plan) return null;
    return JSON.parse(row.plan);
  }

  updatePlanStatus(id: string, status: string): void {
    const plan = this.loadPlan(id);
    if (plan) {
      plan.status = status as Plan["status"];
      this.savePlan(id, plan);
    }
  }
}
