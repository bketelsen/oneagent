import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import type { AppContext } from "./api.js";

export function dashboardRoute(ctx: AppContext): Hono {
  const route = new Hono();

  route.get("/", (c) => {
    const state = ctx.getState();
    return c.html(
      <Layout title="Dashboard">
        <div class="grid grid-cols-3 gap-4 mb-8">
          <div class="bg-gray-800 rounded-lg p-4">
            <div class="text-sm text-gray-400">Active Agents</div>
            <div class="text-3xl font-bold">{state.running.length}</div>
          </div>
          <div class="bg-gray-800 rounded-lg p-4">
            <div class="text-sm text-gray-400">Total Runs</div>
            <div class="text-3xl font-bold">{state.metrics.runs}</div>
          </div>
          <div class="bg-gray-800 rounded-lg p-4">
            <div class="text-sm text-gray-400">Tokens Used</div>
            <div class="text-3xl font-bold">{state.metrics.tokensIn + state.metrics.tokensOut}</div>
          </div>
        </div>

        <h2 class="text-xl font-semibold mb-4">Running Agents</h2>
        {state.running.length === 0
          ? <p class="text-gray-500">No agents running</p>
          : <div class="space-y-2">
              {state.running.map((r) => (
                <a href={`/runs/${r.runId}`} class="block bg-gray-800 rounded-lg p-4 flex justify-between items-center hover:bg-gray-700">
                  <div>
                    <span class="text-blue-400">{r.issueKey}</span>
                    <span class="ml-2 text-gray-500 text-sm">{r.provider}</span>
                  </div>
                  <span class="text-green-400 text-sm">running</span>
                </a>
              ))}
            </div>
        }

        <h2 class="text-xl font-semibold mb-4 mt-8">Recent Runs</h2>
        {(() => {
          const runs = ctx.getRecentRuns?.() ?? [];
          if (runs.length === 0) {
            return <p class="text-gray-500">No runs recorded yet</p>;
          }
          return (
            <div class="overflow-x-auto">
              <table class="w-full text-sm text-left">
                <thead class="text-gray-400 border-b border-gray-700">
                  <tr>
                    <th class="px-4 py-2">Issue</th>
                    <th class="px-4 py-2">Provider</th>
                    <th class="px-4 py-2">Status</th>
                    <th class="px-4 py-2">Started</th>
                    <th class="px-4 py-2">Retries</th>
                    <th class="px-4 py-2">Last Error</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr class="border-b border-gray-800">
                      <td class="px-4 py-2 text-blue-400">{run.issueKey}</td>
                      <td class="px-4 py-2">{run.provider}</td>
                      <td class="px-4 py-2">{run.status}</td>
                      <td class="px-4 py-2 text-gray-400">{run.startedAt}</td>
                      <td class="px-4 py-2">{run.retryCount}</td>
                      <td class="px-4 py-2 text-red-400">{run.lastError ? (run.lastError.length > 100 ? run.lastError.slice(0, 100) + "..." : run.lastError) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}

        <div class="mt-6">
          <button
            onclick="fetch('/api/v1/refresh', {method:'POST'}).then(()=>location.reload())"
            class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm"
          >
            Force Refresh
          </button>
        </div>
      </Layout>
    );
  });

  return route;
}
