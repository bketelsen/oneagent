import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import type { PlanningRepo, Plan, PlanTask } from "../db/planning.js";

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  complexity: z.enum(["low", "medium", "high"]),
  dependsOn: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
});

const phaseSchema = z.object({
  name: z.string(),
  tasks: z.array(taskSchema),
});

const operationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_phase"), phase: phaseSchema }),
  z.object({ type: z.literal("remove_phase"), phaseName: z.string() }),
  z.object({ type: z.literal("add_task"), phaseName: z.string(), task: taskSchema }),
  z.object({ type: z.literal("remove_task"), taskId: z.string() }),
  z.object({ type: z.literal("update_task"), taskId: z.string(), updates: taskSchema.partial().omit({ id: true }) }),
]);

interface PlanningToolsConfig {
  planningRepo: PlanningRepo;
  repoConfig: { owner: string; repo: string; labels: string[] };
}

function formatPlan(plan: Plan): string {
  const lines: string[] = [`# ${plan.title}`, "", plan.description, ""];
  for (const phase of plan.phases) {
    lines.push(`## ${phase.name}`, "");
    for (const task of phase.tasks) {
      const deps = task.dependsOn.length > 0 ? ` (depends on: ${task.dependsOn.join(", ")})` : "";
      lines.push(`### [${task.complexity}] ${task.title}${deps}`, "");
      lines.push(task.body, "");
      if (task.acceptanceCriteria.length > 0) {
        lines.push("**Acceptance Criteria:**");
        for (const ac of task.acceptanceCriteria) {
          lines.push(`- ${ac}`);
        }
        lines.push("");
      }
    }
  }
  return lines.join("\n");
}

export function createPlanningTools(config: PlanningToolsConfig) {
  const { planningRepo, repoConfig } = config;

  const createPlan = defineTool({
    name: "create_plan",
    description: "Create a structured implementation plan with phases and tasks. Each task will become a GitHub issue when published.",
    parameters: z.object({
      sessionId: z.string(),
      title: z.string(),
      description: z.string(),
      phases: z.array(phaseSchema),
    }),
    handler: async ({ sessionId, title, description, phases }) => {
      const plan: Plan = { title, description, phases, status: "draft" };
      planningRepo.savePlan(sessionId, plan);
      return formatPlan(plan);
    },
  });

  const refinePlan = defineTool({
    name: "refine_plan",
    description: "Modify an existing plan. Supports adding/removing phases and tasks, and updating task details.",
    parameters: z.object({
      sessionId: z.string(),
      operations: z.array(operationSchema),
    }),
    handler: async ({ sessionId, operations }) => {
      const plan = planningRepo.loadPlan(sessionId);
      if (!plan) return "Error: No plan found for this session. Use create_plan first.";

      for (const op of operations) {
        switch (op.type) {
          case "add_phase":
            plan.phases.push(op.phase);
            break;
          case "remove_phase":
            plan.phases = plan.phases.filter((p) => p.name !== op.phaseName);
            break;
          case "add_task": {
            const phase = plan.phases.find((p) => p.name === op.phaseName);
            if (!phase) return `Error: Phase "${op.phaseName}" not found.`;
            phase.tasks.push(op.task);
            break;
          }
          case "remove_task":
            for (const phase of plan.phases) {
              phase.tasks = phase.tasks.filter((t) => t.id !== op.taskId);
            }
            break;
          case "update_task":
            for (const phase of plan.phases) {
              const task = phase.tasks.find((t) => t.id === op.taskId);
              if (task) {
                Object.assign(task, op.updates);
                break;
              }
            }
            break;
        }
      }

      planningRepo.savePlan(sessionId, plan);
      return formatPlan(plan);
    },
  });

  const publishPlan = defineTool({
    name: "publish_plan",
    description: "Publish the finalized plan as GitHub issues with dependency graph. Each task becomes an issue with 'Depends on #N' references.",
    parameters: z.object({
      sessionId: z.string(),
    }),
    handler: async ({ sessionId }) => {
      const plan = planningRepo.loadPlan(sessionId);
      if (!plan) return "Error: No plan found for this session.";
      if (plan.status === "published") return "Error: Plan already published.";

      const { owner, repo, labels } = repoConfig;
      const label = labels[0];
      const { execFileSync } = await import("node:child_process");

      // Topologically sort tasks: create leaves (no dependents) first
      const allTasks = plan.phases.flatMap((p) => p.tasks);
      const idToTask = new Map(allTasks.map((t) => [t.id, t]));
      const idToIssueNumber = new Map<string, number>();

      // Sort: tasks with no dependencies first, then tasks whose deps are satisfied
      const sorted: PlanTask[] = [];
      const remaining = new Set(allTasks.map((t) => t.id));
      while (remaining.size > 0) {
        let progress = false;
        for (const id of remaining) {
          const task = idToTask.get(id)!;
          if (task.dependsOn.every((dep) => !remaining.has(dep))) {
            sorted.push(task);
            remaining.delete(id);
            progress = true;
          }
        }
        if (!progress) {
          // Circular dependency — add remaining tasks as-is
          for (const id of remaining) sorted.push(idToTask.get(id)!);
          break;
        }
      }

      const createdIssues: string[] = [];
      for (const task of sorted) {
        // Build issue body
        const bodyParts = [task.body];
        if (task.acceptanceCriteria.length > 0) {
          bodyParts.push("\n## Acceptance Criteria\n" + task.acceptanceCriteria.map((ac) => `- [ ] ${ac}`).join("\n"));
        }
        if (task.dependsOn.length > 0) {
          const depLines = task.dependsOn
            .map((dep) => {
              const num = idToIssueNumber.get(dep);
              return num ? `Depends on #${num}` : `Depends on: ${dep} (not yet created)`;
            })
            .join("\n");
          bodyParts.push("\n## Dependencies\n" + depLines);
        }
        bodyParts.push(`\n_Complexity: ${task.complexity}_`);

        const body = bodyParts.join("\n");
        const result = execFileSync("gh", [
          "issue", "create",
          "--repo", `${owner}/${repo}`,
          "--title", task.title,
          "--body", body,
          "--label", label,
        ], { encoding: "utf-8" });

        // gh issue create outputs the URL like https://github.com/owner/repo/issues/123
        const issueUrlMatch = result.match(/\/issues\/(\d+)/);
        if (issueUrlMatch) {
          const issueNumber = parseInt(issueUrlMatch[1], 10);
          idToIssueNumber.set(task.id, issueNumber);
          task.issueNumber = issueNumber;
          createdIssues.push(`#${issueNumber}: ${task.title}`);
        }
      }

      plan.status = "published";
      planningRepo.savePlan(sessionId, plan);

      return `Published ${createdIssues.length} issues:\n${createdIssues.map((i) => `- ${i}`).join("\n")}`;
    },
  });

  return { createPlan, refinePlan, publishPlan };
}
