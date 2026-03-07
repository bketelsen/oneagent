import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import type { AppContext } from "./api.js";
import { getCostEstimate, formatCost } from "../../utils/cost.js";

export function dashboardRoute(ctx: AppContext): Hono {
  const route = new Hono();

  route.get("/", (c) => {
    const state = ctx.getState();
    const estimatedCost = getCostEstimate(state.metrics.tokensIn, state.metrics.tokensOut);
    return c.html(
      <Layout title="Dashboard">
        <div class="grid grid-cols-4 gap-4 mb-8">
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
          <div class="bg-gray-800 rounded-lg p-4">
            <div class="text-sm text-gray-400">Estimated Cost</div>
            <div class="text-3xl font-bold text-green-400">{formatCost(estimatedCost)}</div>
          </div>
        </div>

        <h2 class="text-xl font-semibold mb-4">Running Agents</h2>
        {state.running.length === 0
          ? <p class="text-gray-500">No agents running</p>
          : <div class="space-y-3">
              {state.running.map((r) => (
                <a href={`/runs/${r.runId}/live`} class="block bg-gray-800 rounded-lg p-4 hover:bg-gray-700 transition-colors">
                  <div class="flex justify-between items-start mb-2">
                    <div class="flex items-center gap-2">
                      <span class="text-blue-400 font-medium">{r.issueKey}</span>
                      <span class="bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">{r.currentAgent ?? "coder"}</span>
                    </div>
                    <span class="text-green-400 text-sm flex items-center gap-1">
                      <span class="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                      running
                    </span>
                  </div>
                  <div class="flex justify-between items-center text-sm">
                    <span class="text-gray-400 truncate max-w-md">{(r.lastActivityDescription ?? "Starting...").slice(0, 80)}</span>
                    <div class="flex items-center gap-4 text-gray-500 shrink-0">
                      <span>{r.toolCallCount ?? 0} tool calls</span>
                      {r.startedAt && (
                        <span class="elapsed-timer" data-started={r.startedAt}>—</span>
                      )}
                    </div>
                  </div>
                </a>
              ))}
            </div>
        }

        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            function updateTimers() {
              document.querySelectorAll('.elapsed-timer').forEach(function(el) {
                var started = new Date(el.getAttribute('data-started')).getTime();
                var elapsed = Math.floor((Date.now() - started) / 1000);
                var h = Math.floor(elapsed / 3600);
                var m = Math.floor((elapsed % 3600) / 60);
                var s = elapsed % 60;
                el.textContent = (h > 0 ? h + 'h ' : '') + m + 'm ' + s + 's';
              });
            }
            updateTimers();
            setInterval(updateTimers, 1000);
          })();
        `}} />

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
                      <td class="px-4 py-2 text-blue-400">
                        <a href={run.status === "running" ? `/runs/${run.id}/live` : `/runs/${run.id}`} class="hover:underline">{run.issueKey}</a>
                      </td>
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
