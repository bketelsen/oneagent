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
});
