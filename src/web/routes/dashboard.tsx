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
