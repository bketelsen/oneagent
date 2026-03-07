import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import type { RunsRepo } from "../../db/runs.js";

export interface LiveContext {
  runsRepo: RunsRepo;
}

export function liveRoute(ctx: LiveContext): Hono {
  const route = new Hono();

  route.get("/:id/live", (c) => {
    const id = c.req.param("id");
    const run = ctx.runsRepo.getById(id);

    if (!run) {
      return c.html(
        <Layout title="Run Not Found">
          <h1 class="text-2xl font-bold mb-4">Run Not Found</h1>
          <p class="text-gray-500 dark:text-gray-400">No run found with ID <code class="text-red-400">{id}</code></p>
          <a href="/" class="text-blue-400 hover:underline mt-4 inline-block">Back to Dashboard</a>
        </Layout>,
        404,
      );
    }

    return c.html(
      <Layout title={`Live — ${run.issueKey}`}>
        <a href="/" class="text-blue-400 hover:underline text-sm mb-4 inline-block">&larr; Back to Dashboard</a>

        <div class="flex justify-between items-start mb-6">
          <h1 class="text-2xl font-bold">Live Run: {run.issueKey}</h1>
          <button id="pause-btn" class="bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1 rounded text-sm transition-colors">
            Pause
          </button>
        </div>

        <div id="run-meta" class="bg-gray-100 dark:bg-gray-800 rounded-lg p-4 mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div class="text-sm text-gray-500 dark:text-gray-400">Issue</div>
            <div class="text-blue-400">{run.issueKey}</div>
          </div>
          <div>
            <div class="text-sm text-gray-500 dark:text-gray-400">Current Agent</div>
            <div id="meta-agent">
              <span class="bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">coder</span>
            </div>
          </div>
          <div>
            <div class="text-sm text-gray-500 dark:text-gray-400">Elapsed</div>
            <div id="meta-elapsed" class="elapsed-timer" data-started={run.startedAt}>—</div>
          </div>
          <div>
            <div class="text-sm text-gray-500 dark:text-gray-400">Tool Calls</div>
            <div id="meta-tools">0</div>
          </div>
        </div>

        <h2 class="text-xl font-semibold mb-4">Event Feed</h2>
        <div id="event-feed" class="space-y-2 max-h-[70vh] overflow-y-auto pr-2">
          <p class="text-gray-400 dark:text-gray-500" id="feed-placeholder">Waiting for events...</p>
        </div>

        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var runId = ${JSON.stringify(id)};
            var feed = document.getElementById('event-feed');
            var placeholder = document.getElementById('feed-placeholder');
            var pauseBtn = document.getElementById('pause-btn');
            var metaAgent = document.getElementById('meta-agent');
            var metaTools = document.getElementById('meta-tools');
            var autoScroll = true;
            var toolCount = 0;

            pauseBtn.addEventListener('click', function() {
              autoScroll = !autoScroll;
              pauseBtn.textContent = autoScroll ? 'Pause' : 'Resume';
              pauseBtn.className = autoScroll
                ? 'bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 px-3 py-1 rounded text-sm transition-colors'
                : 'bg-yellow-600 hover:bg-yellow-500 px-3 py-1 rounded text-sm transition-colors';
            });

            // Elapsed timer
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

            function escapeHtml(str) {
              var div = document.createElement('div');
              div.textContent = str;
              return div.innerHTML;
            }

            function renderEvent(data) {
              var type = data.type || '';
              // Strip "agent:" prefix if present
              var cleanType = type.replace(/^agent:/, '');
              var el = document.createElement('div');
              el.className = 'rounded-lg p-3 text-sm';

              if (cleanType === 'text') {
                el.className += ' bg-gray-50 dark:bg-gray-900 font-mono text-gray-700 dark:text-gray-300';
                el.innerHTML = '<div class="text-xs text-gray-400 dark:text-gray-500 mb-1">text</div>' +
                  '<pre class="whitespace-pre-wrap">' + escapeHtml(data.content || data.text || '') + '</pre>';
              } else if (cleanType === 'tool_call') {
                el.className += ' bg-gray-100 dark:bg-gray-800 border-l-4 border-blue-500';
                var args = JSON.stringify(data.args || data.arguments || {}, null, 2);
                var argsHtml = args.length > 200
                  ? '<details class="mt-1"><summary class="text-blue-400 cursor-pointer text-xs">Show args</summary><pre class="mt-1 text-xs whitespace-pre-wrap overflow-x-auto">' + escapeHtml(args) + '</pre></details>'
                  : '<pre class="mt-1 text-xs whitespace-pre-wrap overflow-x-auto">' + escapeHtml(args) + '</pre>';
                el.innerHTML = '<div class="text-blue-400 font-medium">Tool Call: ' + escapeHtml(data.toolName || 'unknown') + '</div>' + argsHtml;
              } else if (cleanType === 'tool_result') {
                el.className += ' bg-gray-100 dark:bg-gray-800 border-l-4 border-green-500';
                var result = typeof data.result === 'string' ? data.result : JSON.stringify(data.result || data.output || '', null, 2);
                var resultHtml = result.length > 200
                  ? '<details class="mt-1"><summary class="text-green-400 cursor-pointer text-xs">Show result</summary><pre class="mt-1 text-xs whitespace-pre-wrap overflow-x-auto">' + escapeHtml(result) + '</pre></details>'
                  : '<pre class="mt-1 text-xs whitespace-pre-wrap overflow-x-auto">' + escapeHtml(result) + '</pre>';
                el.innerHTML = '<div class="text-green-400 font-medium">Tool Result</div>' + resultHtml;
              } else if (cleanType === 'handoff') {
                el.className += ' bg-gray-100 dark:bg-gray-800 border-l-4 border-yellow-500';
                el.innerHTML = '<div class="text-yellow-400 font-medium">Handoff: ' +
                  escapeHtml(data.fromAgent || '?') + ' → ' + escapeHtml(data.toAgent || '?') + '</div>';
              } else if (cleanType === 'error') {
                el.className += ' bg-gray-100 dark:bg-gray-800 border-l-4 border-red-500';
                el.innerHTML = '<div class="text-red-400 font-medium">Error</div>' +
                  '<pre class="mt-1 text-xs whitespace-pre-wrap text-red-300">' + escapeHtml(data.error || data.message || JSON.stringify(data)) + '</pre>';
              } else if (cleanType === 'done') {
                el.className += ' bg-gray-100 dark:bg-gray-800 border-l-4 border-gray-500';
                var usage = data.usage || {};
                el.innerHTML = '<div class="text-gray-300 font-medium">Done</div>' +
                  '<div class="text-xs text-gray-400 dark:text-gray-500 mt-1">Tokens: ' +
                  (usage.inputTokens || 0) + ' in / ' + (usage.outputTokens || 0) + ' out</div>';
              } else {
                el.className += ' bg-gray-100 dark:bg-gray-800';
                el.innerHTML = '<div class="text-gray-500 dark:text-gray-400 text-xs">' + escapeHtml(cleanType || 'unknown') + '</div>' +
                  '<pre class="text-xs whitespace-pre-wrap">' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
              }

              return el;
            }

            var es = new EventSource('/api/v1/events');
            es.onmessage = function(e) {
              try {
                var event = JSON.parse(e.data);
                var data = event.data || event;

                // Filter by runId
                if (data.runId && data.runId !== runId) return;

                // Remove placeholder
                if (placeholder && placeholder.parentNode) {
                  placeholder.parentNode.removeChild(placeholder);
                  placeholder = null;
                }

                // Update metadata
                if (data.toAgent) {
                  metaAgent.innerHTML = '<span class="bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">' + escapeHtml(data.toAgent) + '</span>';
                }
                var type = (event.type || data.type || '').replace(/^agent:/, '');
                if (type === 'tool_call') {
                  toolCount++;
                  metaTools.textContent = toolCount;
                }

                feed.appendChild(renderEvent({ type: event.type || data.type, ...data }));

                if (autoScroll) {
                  feed.scrollTop = feed.scrollHeight;
                }
              } catch(err) {
                console.error('Failed to parse SSE event:', err);
              }
            };
          })();
        `}} />
      </Layout>,
    );
  });

  return route;
}
