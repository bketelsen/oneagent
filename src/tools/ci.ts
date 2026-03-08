import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import { execFileSync } from "node:child_process";

export const checkCIStatusTool = defineTool({
  name: "check_ci_status",
  description: "Check CI status for a pull request",
  parameters: z.object({
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.number().describe("Pull request number"),
  }),
  handler: async ({ owner, repo, prNumber }) => {
    const result = execFileSync("gh", [
      "pr", "checks", String(prNumber),
      "--repo", `${owner}/${repo}`,
      "--json", "name,state,conclusion",
    ], { encoding: "utf-8" });
    return result;
  },
});
