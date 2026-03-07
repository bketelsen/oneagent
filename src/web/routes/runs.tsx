import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import type { RunsRepo } from "../../db/runs.js";
import type { RunEventsRepo } from "../../db/run-events.js";
import type { MetricsRepo } from "../../db/metrics.js";
import { getCostEstimate, formatCost } from "../../utils/cost.js";

export interface RunsContext {
  runsRepo: RunsRepo;
  eventsRepo: RunEventsRepo;
  metricsRepo?: MetricsRepo;
}

export function runsRoute(ctx: RunsContext): Hono {
  const route = new Hono();

  route.get("/:id", (c) => {
    const id = c.req.param("id");
    const run = ctx.runsRepo.getById(id);

    if (!run) {
      return c.html(
        <Layout title="Run Not Found">
          <h1 class="text-2xl font-bold mb-4">Run Not Found</h1>
          <p class="text-gray-400">No run found with ID <code class="text-red-400">{id}</code></p>
          <a href="/" class="text-blue-400 hover:underline mt-4 inline-block">Back to Dashboard</a>
        </Layout>,
        404,
      );
    }

    const events = ctx.eventsRepo.listByRun(id);
    const runTokens = ctx.metricsRepo?.tokensByRun(id) ?? { tokensIn: 0, tokensOut: 0 };
    const runCost = getCostEstimate(runTokens.tokensIn, runTokens.tokensOut);

    const statusColor =
      run.status === "running" ? "text-green-400" :
      run.status === "failed" ? "text-red-400" :
      run.status === "done" ? "text-blue-400" :
      "text-gray-400";

    return c.html(
      <Layout title={`Run ${run.id}`}>
        <a href="/" class="text-blue-400 hover:underline text-sm mb-4 inline-block">&larr; Back to Dashboard</a>

        <h1 class="text-2xl font-bold mb-6">Run Detail</h1>

        <div class="bg-gray-800 rounded-lg p-6 mb-8">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <div class="text-sm text-gray-400">Run ID</div>
              <div class="font-mono text-sm">{run.id}</div>
            </div>
            <div>
              <div class="text-sm text-gray-400">Issue</div>
              <div class="text-blue-400">
                {(() => {
                  const match = run.issueKey.match(/^(.+?)\/(.+?)#(\d+)$/);
                  if (match) {
                    const [, owner, repo, number] = match;
                    return (
                      <a
                        href={`https://github.com/${owner}/${repo}/issues/${number}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="hover:underline"
                      >
                        #{number}
                      </a>
                    );
                  }
                  return run.issueKey;
                })()}
              </div>
            </div>
            <div>
              <div class="text-sm text-gray-400">Status</div>
              <div class={statusColor}>{run.status}</div>
            </div>
            <div>
              <div class="text-sm text-gray-400">Provider</div>
              <div>{run.provider}</div>
            </div>
            <div>
              <div class="text-sm text-gray-400">Started At</div>
              <div>{run.startedAt}</div>
            </div>
            <div>
              <div class="text-sm text-gray-400">Completed At</div>
              <div>{run.completedAt ?? "—"}</div>
            </div>
            {run.model && (
              <div>
                <div class="text-sm text-gray-400">Model</div>
                <div>{run.model}</div>
              </div>
            )}
            <div>
              <div class="text-sm text-gray-400">Retry Count</div>
              <div>{run.retryCount}</div>
            </div>
            <div>
              <div class="text-sm text-gray-400">Tokens (In / Out)</div>
              <div>{runTokens.tokensIn.toLocaleString()} / {runTokens.tokensOut.toLocaleString()}</div>
            </div>
            <div>
              <div class="text-sm text-gray-400">Estimated Cost</div>
              <div class="text-green-400">{formatCost(runCost)}</div>
            </div>
            {run.error && (
              <div class="col-span-2">
                <div class="text-sm text-gray-400">Error</div>
                <div class="text-red-400 font-mono text-sm">{run.error}</div>
              </div>
            )}
          </div>
        </div>

        <h2 class="text-xl font-semibold mb-4">Events ({events.length})</h2>
        {events.length === 0
          ? <p class="text-gray-500">No events recorded for this run.</p>
          : <div class="space-y-2">
              {events.map((event) => (
                <div class="bg-gray-800 rounded-lg p-4">
                  <div class="flex justify-between items-start mb-2">
                    <span class="text-blue-400 font-medium">{event.type}</span>
                    <span class="text-gray-500 text-sm">{event.ts}</span>
                  </div>
                  <pre class="text-sm text-gray-300 bg-gray-900 rounded p-3 overflow-x-auto">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
        }
      </Layout>,
    );
  });

  return route;
}
