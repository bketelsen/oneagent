import { z } from "zod";

// Helper: zod v4 doesn't apply inner defaults when outer default is {}.
// Use preprocess to coerce undefined/null to {} before parsing the inner schema.
function withDefault<T extends z.ZodObject<z.ZodRawShape>>(schema: T) {
  return z.preprocess((val) => val ?? {}, schema);
}

const repoSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  labels: z.array(z.string()),
  provider: z.string().optional(),
  model: z.string().optional(),
});

const githubSchema = z.object({
  token: z.string().optional(),
  repos: z.array(repoSchema).min(1),
});

const agentSchema = z.object({
  provider: z.string().default("claude-code"),
  model: z.string().optional(),
  stallTimeout: z.number().default(300000),
  maxRetries: z.number().default(3),
  retryBaseDelay: z.number().default(60000),
});

const concurrencySchema = z.object({
  max: z.number().default(3),
});

const pollSchema = z.object({
  interval: z.number().default(30000),
  reconcileInterval: z.number().default(15000),
});

const statusesSchema = z.object({
  todo: z.string().default("Todo"),
  inProgress: z.string().default("In Progress"),
  inReview: z.string().default("In Review"),
  done: z.string().default("Done"),
});

const projectSchema = z.object({
  id: z.string().optional(),
  statuses: withDefault(statusesSchema),
});

const hooksSchema = z.object({
  setup: z.string().optional(),
  teardown: z.string().optional(),
});

const workspaceSchema = z.object({
  baseDir: z.string().default("./workspaces"),
  hooks: withDefault(hooksSchema),
});

const webSchema = z.object({
  port: z.number().default(3000),
  enabled: z.boolean().default(true),
});

const labelsSchema = z.object({
  eligible: z.string().default("oneagent"),
  inProgress: z.string().default("oneagent-working"),
  failed: z.string().default("oneagent-failed"),
});

export const configSchema = z.object({
  github: githubSchema,
  agent: withDefault(agentSchema),
  concurrency: withDefault(concurrencySchema),
  poll: withDefault(pollSchema),
  project: withDefault(projectSchema),
  workspace: withDefault(workspaceSchema),
  labels: withDefault(labelsSchema),
  web: withDefault(webSchema),
});

export type Config = z.infer<typeof configSchema>;
