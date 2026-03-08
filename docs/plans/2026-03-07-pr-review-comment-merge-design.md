# PR Review Agent — Comment + Merge Flow

## Problem

The pr-reviewer agent runs as the same GitHub user that opened the PR. GitHub doesn't allow self-approval, so formal `APPROVE` reviews fail or are ignored.

## Solution

Replace the formal review submission with a structured tool call (`submit_review`) that returns the verdict to the orchestrator. The orchestrator then takes the appropriate action on GitHub.

## Flow

### Approve path

1. Reviewer agent analyzes diff, calls `submit_review` tool with `verdict: "approve"` and a summary
2. Tool returns the verdict to the orchestrator
3. Orchestrator posts the summary as a PR comment via GitHub API
4. If `autoMerge` is enabled, orchestrator runs `tryAutoMerge()` (existing logic: check CI, then merge)
5. If `autoMerge` is off, just leaves the comment — no merge

### Request changes path

1. Reviewer agent calls `submit_review` with `verdict: "request_changes"`, summary, and inline comments
2. Orchestrator submits a `COMMENT` review (not `REQUEST_CHANGES`) via `submitPRReview()` with inline comments
3. Existing `PRMonitor` / `tickReviewFeedback` flow picks up the comments for coder iteration
4. Review cycle counting works as before

## Changes Required

1. **New tool**: `submit_review` in `src/tools/` — accepts `{ verdict, summary, comments? }`, validates input, returns structured data to the orchestrator
2. **`executeReviewAgentRun()`**: Capture the tool call result to get the verdict, pass it to `onReviewComplete()`
3. **`onReviewComplete()`**: Instead of reading `fetchPRReviews()` to determine outcome, use the verdict from the tool call. Post the comment/review accordingly.
4. **PR reviewer prompt**: Update to instruct the agent to use `submit_review` tool instead of submitting reviews directly
5. **`submitPRReview()`**: Keep the method but the approve path uses a regular PR comment instead of a formal review
6. **No config changes** — `autoMerge` toggle and `requireChecks` stay as-is

## What stays the same

- `tryAutoMerge()` logic unchanged
- Review cycle state management unchanged
- `PRMonitor` feedback iteration unchanged
- Config schema unchanged
