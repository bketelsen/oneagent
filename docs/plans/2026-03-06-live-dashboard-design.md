# Live Dashboard Design

## Goal

Add real-time visibility into running agent sessions on the dashboard — a summary card showing current agent, last activity, elapsed time, and tool count, plus a live detail page with a full streaming event feed.

## Data Layer

Add fields to `RunEntry` in `src/orchestrator/state.ts` (in-memory only, no DB changes):

- `currentAgent: string` — updated on handoff events (default: "coder")
- `lastActivityDescription: string` — human-readable last event (e.g., "Called Bash: npm test")
- `toolCallCount: number` — incremented on each `tool_call` chunk

Updated in the `executeRun` stream loop as chunks arrive.

## Dashboard Summary Card

Replace the minimal "Running Agents" cards in `dashboard.tsx` with richer cards showing:

- Issue key (links to live page)
- Current agent name (badge)
- Elapsed time (client-side JS timer, updates every second)
- Last activity description (truncated to ~80 chars)
- Tool call count

`getState()` returns these new fields for each running entry.

## Live Detail Page

New route: `GET /runs/:id/live`

**Layout:**
- Top: run metadata (issue, current agent, elapsed time, tool count)
- Below: scrolling event feed, real-time via SSE

**Event rendering by type:**
- `text` — monospace, gray background, full content
- `tool_call` — blue accent, tool name + args (collapsible if long)
- `tool_result` — green accent, result text (collapsible if long)
- `handoff` — yellow accent, "fromAgent → toAgent"
- `error` — red accent, full error text
- `done` — summary with token usage

**Behavior:**
- Connects to `/api/v1/events` SSE endpoint, filters by `runId`
- Auto-scrolls to follow new events
- "Pause" button stops auto-scroll, resumes on click
- Dashboard cards link to live page for running sessions, static `/runs/:id` for completed

## No Changes To

- Database schema
- SSE infrastructure (already broadcasts all chunk types)
- Agent graph or prompts
