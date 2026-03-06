import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import { execFileSync } from "node:child_process";

export const readIssueTool = defineTool({
  name: "github_read_issue",
  description: "Read a GitHub issue's title, body, and comments",
  parameters: z.object({
    owner: z.string(),
    repo: z.string(),
    number: z.number(),
  }),
  handler: async ({ owner, repo, number }) => {
    const result = execFileSync("gh", [
      "issue", "view", String(number),
      "--repo", `${owner}/${repo}`,
      "--json", "title,body,comments",
    ], { encoding: "utf-8" });
    return result;
  },
});

export const createPRTool = defineTool({
  name: "github_create_pr",
  description: "Create a pull request",
  parameters: z.object({
    owner: z.string(),
    repo: z.string(),
    title: z.string(),
    body: z.string(),
    head: z.string(),
    base: z.string().default("main"),
  }),
  handler: async ({ owner, repo, title, body, head, base }) => {
    const result = execFileSync("gh", [
      "pr", "create",
      "--repo", `${owner}/${repo}`,
      "--title", title,
      "--body", body,
      "--head", head,
      "--base", base,
    ], { encoding: "utf-8" });
    return result;
  },
});
