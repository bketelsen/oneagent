import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { PlanningRepo } from "../../db/planning.js";
import { runMigrations } from "../../db/migrations.js";
import { createPlanningTools } from "../planning.js";

describe("planning tools", () => {
  let db: Database.Database;
  let repo: PlanningRepo;
  let tools: ReturnType<typeof createPlanningTools>;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    repo = new PlanningRepo(db);
    tools = createPlanningTools({ planningRepo: repo, repoConfig: { owner: "test", repo: "test", labels: ["oneagent"] } });
  });

  it("create_plan persists and returns markdown", async () => {
    const result = await tools.createPlan.handler({
      sessionId: "s1",
      title: "My Plan",
      description: "Test plan",
      phases: [{
        name: "Phase 1",
        tasks: [{
          id: "t1",
          title: "Task 1",
          body: "Implementation details",
          complexity: "low",
          dependsOn: [],
          acceptanceCriteria: ["Works"],
        }],
      }],
    });

    expect(result).toContain("My Plan");
    expect(result).toContain("Task 1");

    const plan = repo.loadPlan("s1");
    expect(plan).not.toBeNull();
    expect(plan!.title).toBe("My Plan");
    expect(plan!.status).toBe("draft");
  });

  it("refine_plan adds a task to existing plan", async () => {
    await tools.createPlan.handler({
      sessionId: "s2",
      title: "Original",
      description: "desc",
      phases: [{ name: "P1", tasks: [{ id: "t1", title: "Task 1", body: "body", complexity: "low", dependsOn: [], acceptanceCriteria: [] }] }],
    });

    const result = await tools.refinePlan.handler({
      sessionId: "s2",
      operations: [
        { type: "add_task", phaseName: "P1", task: { id: "t2", title: "Task 2", body: "new body", complexity: "medium", dependsOn: ["t1"], acceptanceCriteria: ["tested"] } },
      ],
    });

    expect(result).toContain("Task 2");
    const plan = repo.loadPlan("s2");
    expect(plan!.phases[0].tasks).toHaveLength(2);
    expect(plan!.phases[0].tasks[1].dependsOn).toEqual(["t1"]);
  });

  it("refine_plan removes a task", async () => {
    await tools.createPlan.handler({
      sessionId: "s3",
      title: "Plan",
      description: "desc",
      phases: [{ name: "P1", tasks: [
        { id: "t1", title: "Task 1", body: "body", complexity: "low", dependsOn: [], acceptanceCriteria: [] },
        { id: "t2", title: "Task 2", body: "body", complexity: "low", dependsOn: [], acceptanceCriteria: [] },
      ] }],
    });

    await tools.refinePlan.handler({
      sessionId: "s3",
      operations: [{ type: "remove_task", taskId: "t1" }],
    });

    const plan = repo.loadPlan("s3");
    expect(plan!.phases[0].tasks).toHaveLength(1);
    expect(plan!.phases[0].tasks[0].id).toBe("t2");
  });

  it("refine_plan returns error for missing plan", async () => {
    const result = await tools.refinePlan.handler({
      sessionId: "nonexistent",
      operations: [],
    });
    expect(result).toContain("Error");
  });

  it("refine_plan adds and removes phases", async () => {
    await tools.createPlan.handler({
      sessionId: "s4",
      title: "Plan",
      description: "desc",
      phases: [{ name: "P1", tasks: [] }],
    });

    await tools.refinePlan.handler({
      sessionId: "s4",
      operations: [
        { type: "add_phase", phase: { name: "P2", tasks: [{ id: "t1", title: "T1", body: "b", complexity: "high", dependsOn: [], acceptanceCriteria: [] }] } },
      ],
    });

    let plan = repo.loadPlan("s4");
    expect(plan!.phases).toHaveLength(2);

    await tools.refinePlan.handler({
      sessionId: "s4",
      operations: [{ type: "remove_phase", phaseName: "P1" }],
    });

    plan = repo.loadPlan("s4");
    expect(plan!.phases).toHaveLength(1);
    expect(plan!.phases[0].name).toBe("P2");
  });
});
