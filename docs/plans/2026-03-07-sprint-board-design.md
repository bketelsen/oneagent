# Sprint Board Design

## Problem

The `/sprint` endpoint always shows empty because `getBoard()` is hardcoded to return empty arrays (`src/index.ts:110`).

## Solution

Replace the stub with a real implementation combining GitHub issues (open + recently closed) with orchestrator run state and RunsRepo data.

## Column Mapping

| Column | Source | Criteria |
|--------|--------|----------|
| Todo | GitHub API | Open issue with eligible label, no active run, no open PR |
| In Progress | Orchestrator RunState | Issue has an actively running agent |
| In Review | GitHub API | Open issue with `hasOpenPR === true` |
| Done | GitHub API + RunsRepo | Issue closed within last 30 days AND has a completed run |

## Data Flow

1. `getBoard()` fetches open eligible issues and recently closed issues in parallel
2. Open issues are categorized by checking `orchestrator.state.isRunning()` and `issue.hasOpenPR`
3. Closed issues are filtered to those with a "completed" run in RunsRepo

## Changes

1. **`src/github/client.ts`** — New `fetchClosedIssues(owner, repo, since)` method
2. **`src/index.ts`** — Replace `getBoard` stub with real implementation
3. **`src/web/routes/sprint.tsx`** — Add refresh button

## Notes

- No SSE; refresh button provides manual reload
- Done column scoped to last 30 days to prevent unbounded growth
- `SprintContext` interface unchanged — `getBoard()` signature already fits
- "completed" in RunsRepo means agent finished (not PR merged); combined with issue closed state for accuracy
