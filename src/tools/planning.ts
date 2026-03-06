import { defineTool } from "one-agent-sdk";
import { z } from "zod";

export const createPlanTool = defineTool({
  name: "create_plan",
  description: "Create a structured implementation plan from requirements",
  parameters: z.object({
    title: z.string(),
    phases: z.array(z.object({
      name: z.string(),
      tasks: z.array(z.object({
        description: z.string(),
        complexity: z.enum(["low", "medium", "high"]),
      })),
    })),
  }),
  handler: async ({ title, phases }) => {
    const plan = phases.map((p) =>
      `## ${p.name}\n${p.tasks.map((t) => `- [${t.complexity}] ${t.description}`).join("\n")}`
    ).join("\n\n");
    return `# ${title}\n\n${plan}`;
  },
});

export const refinePlanTool = defineTool({
  name: "refine_plan",
  description: "Refine an existing plan based on feedback",
  parameters: z.object({
    currentPlan: z.string(),
    feedback: z.string(),
  }),
  handler: async ({ currentPlan, feedback }) => {
    return `Plan to refine:\n${currentPlan}\n\nFeedback:\n${feedback}`;
  },
});
