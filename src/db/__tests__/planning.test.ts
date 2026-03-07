import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../migrations.js";
import { PlanningRepo } from "../planning.js";

describe("PlanningRepo", () => {
  let db: Database.Database;
  let repo: PlanningRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new PlanningRepo(db);
  });
  afterEach(() => { db.close(); });

  it("creates and loads a session", () => {
    repo.save("s1", [{ role: "user", content: "hello" }]);
    const history = repo.load("s1");
    expect(history).toHaveLength(1);
    expect(history[0].content).toBe("hello");
  });

  it("updates existing session", () => {
    repo.save("s1", [{ role: "user", content: "hello" }]);
    repo.save("s1", [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    const history = repo.load("s1");
    expect(history).toHaveLength(2);
  });

  it("returns empty array for unknown session", () => {
    expect(repo.load("nonexistent")).toEqual([]);
  });

  it("lists all sessions", () => {
    repo.save("s1", [{ role: "user", content: "a" }]);
    repo.save("s2", [{ role: "user", content: "b" }]);
    const sessions = repo.list();
    expect(sessions).toHaveLength(2);
  });

  describe("plan storage", () => {
    it("saves and loads a plan", () => {
      const plan = {
        title: "Test Plan",
        description: "A test plan",
        phases: [{
          name: "Phase 1",
          tasks: [{
            id: "t1",
            title: "Task 1",
            body: "Do the thing",
            complexity: "low" as const,
            dependsOn: [],
            acceptanceCriteria: ["It works"],
          }],
        }],
        status: "draft" as const,
      };
      repo.savePlan("session-1", plan);
      const loaded = repo.loadPlan("session-1");
      expect(loaded).toEqual(plan);
    });

    it("returns null for missing plan", () => {
      repo.save("session-2", []);
      expect(repo.loadPlan("session-2")).toBeNull();
    });

    it("updates plan status", () => {
      const plan = {
        title: "Test",
        description: "desc",
        phases: [],
        status: "draft" as const,
      };
      repo.savePlan("session-3", plan);
      repo.updatePlanStatus("session-3", "published");
      const loaded = repo.loadPlan("session-3");
      expect(loaded?.status).toBe("published");
    });

    it("list includes plan status", () => {
      repo.save("session-4", []);
      const plan = { title: "T", description: "d", phases: [], status: "draft" as const };
      repo.savePlan("session-4", plan);
      const sessions = repo.list();
      expect(sessions[0].status).toBe("draft");
    });
  });
});
