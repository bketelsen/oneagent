# PR Review Agent Design

**Date:** 2026-03-07
**Status:** Approved

## Overview

Add a dedicated PR review agent that uses a different model from the coder agent. The review agent independently reviews PRs created by the coder, submits GitHub PR reviews (approve/request-changes), and can optionally merge PRs when enabled. The coder agent addresses any review feedback through the existing review iteration flow.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger | Automatic on coder completion + label for visibility/manual trigger | Enables both automated and human-initiated reviews |
| Model config | Dedicated `prReview.model` / `prReview.provider` | Simple, direct — no need for general per-agent overrides yet |
| Merge safety | Config flag + CI checks must pass | Prevents merging broken code without requiring human approval |
| Review communication | GitHub PR reviews (approve/request-changes) with inline comments | Creates real review trail; plugs into existing review iteration flow |
| Cycle limit | Max 2 cycles (configurable), escalate with `oneagent-needs-human` label | Prevents infinite loops between reviewer and coder |
| Approve without merge | Yes — agent submits approval even if autoMerge is off | Signals to humans that the PR passed automated review |
| Re-review trigger | On coder review-fix run completion | Clean — orchestrator already tracks run types |

## Config Schema Changes

Expand existing `prReviewSchema` in `src/config/schema.ts`:

```typescript
prReviewSchema = z.object({
  enabled: z.boolean().default(true),
  pollInterval: z.number().min(5000).default(60000),
  // New fields:
  provider: z.string().default("claude-code"),
  model: z.string().optional(),
  autoMerge: z.boolean().default(false),
  maxReviewCycles: z.number().min(1).default(2),
  requireChecks: z.boolean().default(true),
});
```

Example config:
```yaml
prReview:
  enabled: true
  provider: claude-code
  model: claude-sonnet-4-6
  autoMerge: false
  maxReviewCycles: 2
```

## PR Reviewer Agent

New file: `src/agents/skills/pr-reviewer.ts`

```typescript
export const prReviewerAgent: AgentDef = {
  name: "pr-reviewer",
  description: "Reviews pull requests for code quality, correctness, and test coverage",
  prompt: `You are a senior code reviewer...`,
  handoffs: [],  // Independent agent, no handoffs
};
```

Review criteria: correctness, test coverage, security (OWASP top 10), error handling, consistency with existing codebase. Does NOT nitpick style.

Actions: Submit APPROVE or REQUEST_CHANGES GitHub PR review with inline comments. The agent calls GitHub tools directly (not parsed by orchestrator).

## GitHub Client Additions

New methods in `src/github/client.ts`:

- **`submitPRReview(owner, repo, prNumber, event, body, comments?)`** — wraps `pulls.createReview`, supports inline file comments
- **`mergePR(owner, repo, prNumber, mergeMethod?)`** — squash merge by default
- **`allChecksPassed(owner, repo, ref)`** — uses existing `fetchCheckRuns`, returns true only when all checks complete successfully

## Orchestrator Flow

```
Coder run completes successfully
  → PR exists?
    → Yes: Add `oneagent-needs-review` label
           → Dispatch pr-reviewer with prReview.provider/model
             → Agent submits GitHub PR review
               → APPROVE:
                   autoMerge=true → CI green? → mergePR() → remove labels
                   autoMerge=false → remove labels, done
               → REQUEST_CHANGES:
                   cycleCount < maxReviewCycles:
                     → Remove `oneagent-needs-review`, add `oneagent-working`
                     → Existing tickReviewFeedback() detects review comments
                     → Coder addresses feedback → pushes fixes
                     → Coder review-fix run completes
                     → Add `oneagent-needs-review` → re-dispatch reviewer
                   cycleCount >= maxReviewCycles:
                     → Add `oneagent-needs-human`, remove other labels, stop
    → No: Done
```

New orchestrator methods:
- **`onRunComplete(runEntry)`** — after coder run, checks for PR, dispatches review
- **`dispatchReview(prInfo, cycleCount)`** — builds review prompt, uses prReview config for model/provider
- **`onReviewComplete(reviewResult, cycleCount)`** — handles approve/request-changes/merge/escalate

## Label Lifecycle

| State | Labels on PR |
|-------|-------------|
| Coder working | `oneagent-working` |
| PR created, awaiting review | `oneagent-needs-review` |
| Review agent reviewing | `oneagent-needs-review` |
| Approved + merged (or no autoMerge) | Labels removed |
| Changes requested | `oneagent-working` (coder fixing) |
| Coder fix complete | `oneagent-needs-review` (re-review) |
| Max cycles exceeded | `oneagent-needs-human` |
| Human manual trigger | Add `oneagent-needs-review` to any PR |

## Database Tracking

- Review runs stored in `runs` table with `run_type` field: `"issue"`, `"pr-review-fix"`, or `"pr-review"`
- Review cycle count tracked per PR key in orchestrator in-memory state
- Metrics recorded separately for review runs (tokens, duration)

## Out of Scope

- No changes to existing agent graph (coder handoffs unchanged)
- No general per-agent model overrides
- No webhook infrastructure
- No changes to existing `reviewer` handoff agent (different role)
