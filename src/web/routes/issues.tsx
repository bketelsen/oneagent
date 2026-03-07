import { Hono } from "hono";
import { Layout } from "../components/layout.js";

export interface IssuesContext {
  getRunEvents: (issueKey: string) => Array<{ type: string; payload: Record<string, unknown>; ts: string }>;
  getRunHistory: (issueKey: string) => Array<{ id: string; status: string; startedAt: string; provider: string }>;
}

export function issuesRoute(ctx: IssuesContext): Hono {
  const route = new Hono();

  route.get("/:owner/:repo/:id", (c) => {
    const { owner, repo, id } = c.req.param();
    const issueKey = `${owner}/${repo}#${id}`;
    const events = ctx.getRunEvents(issueKey);
    const history = ctx.getRunHistory(issueKey);

    return c.html(
      <Layout title={issueKey}>
        <h1 class="text-2xl font-bold mb-4">{issueKey}</h1>

        <h2 class="text-lg font-semibold mb-2">Run History</h2>
        <div class="space-y-2 mb-6">
          {history.map((run) => (
            <div class="bg-gray-100 dark:bg-gray-800 rounded p-3 flex justify-between text-sm">
              <span>{run.id}</span>
              <span>{run.provider}</span>
              <span class={run.status === "completed" ? "text-green-400" : "text-red-400"}>{run.status}</span>
              <span class="text-gray-400 dark:text-gray-500">{run.startedAt}</span>
            </div>
          ))}
        </div>

        <h2 class="text-lg font-semibold mb-2">Agent Output</h2>
        <div class="bg-gray-50 dark:bg-black rounded p-4 font-mono text-xs max-h-96 overflow-y-auto" id="output">
          {events
            .filter((e) => e.type === "text")
            .map((e) => <div>{String((e.payload as any).text ?? "")}</div>)}
        </div>
      </Layout>
    );
  });

  return route;
}
