# Skip Issues With Pending PRs

## Problem

When the orchestrator starts, it sees open issues (e.g. #26) and dispatches agents for them, even when a pull request (e.g. #29) already exists for that issue but hasn't been merged yet. This wastes agent capacity on work that's already in flight.

## Current State

- `Issue.hasOpenPR` field exists in `src/github/types.ts`
- `orchestrator.ts:92` already checks `if (issue.hasOpenPR) continue;`
- But `hasOpenPR` is hardcoded to `false` in `GitHubClient.fetchIssues()` (`client.ts:39`)

## Design

Populate `hasOpenPR` by fetching open PRs for the repo and matching them to issues via PR body text.

### Changes

**`src/github/client.ts`** only:

1. In `fetchIssues()`, after fetching issues, also call `octokit.rest.pulls.list({ owner, repo, state: "open", per_page: 100 })` to get all open PRs for the repo.

2. For each PR, scan the body for GitHub linking keywords:
   ```
   /(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#(\d+)/gi
   ```

3. Collect matched issue numbers into a `Set<number>`.

4. When mapping issues, set `hasOpenPR: linkedIssues.has(issue.number)` instead of `false`.

### Data Flow

```
fetchIssues(owner, repo, label)
  +-- issues.listForRepo(...)        -> issues[]
  +-- pulls.list(...)                 -> prs[]          (NEW)
  +-- extract issue numbers from PR bodies -> Set<number>
  +-- map issues with hasOpenPR = set.has(issue.number)
```

### No Changes Needed

- `types.ts` -- `hasOpenPR` field already exists
- `orchestrator.ts` -- skip check already exists at line 92
- No new config, no new dependencies

### Performance

One extra API call per repo per poll tick (30s default). Handles up to 100 open PRs per repo.

### Edge Cases

- PR with no body: no match, `hasOpenPR` stays false (correct)
- Multiple PRs for one issue: still sets `hasOpenPR: true` (correct)
- Cross-repo PR references: won't match (acceptable, same-repo scope)
