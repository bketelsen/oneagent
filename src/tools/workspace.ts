import { defineTool } from "one-agent-sdk";
import { z } from "zod";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const setupWorkspaceTool = defineTool({
  name: "workspace_setup",
  description: "Set up a workspace directory for an issue",
  parameters: z.object({
    issueKey: z.string(),
    baseDir: z.string(),
  }),
  handler: async ({ issueKey, baseDir }) => {
    const dirName = issueKey.replace(/[/#]/g, "-");
    const dir = join(baseDir, dirName);
    mkdirSync(dir, { recursive: true });
    return `Workspace created at ${dir}`;
  },
});
