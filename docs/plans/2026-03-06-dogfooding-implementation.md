# Dogfooding Setup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Configure oneagent to work on its own repository and create the first wave of dogfooding issues.

**Architecture:** Update the YAML config to target `bketelsen/oneagent` with a `dogfood` label, then create 5 well-scoped GitHub issues for Wave 1 validation.

**Tech Stack:** YAML config, GitHub CLI (`gh`)

---

### Task 1: Update oneagent.yaml config

**Files:**
- Modify: `oneagent.yaml`

**Step 1: Replace the config**

Replace the entire contents of `oneagent.yaml` with:

```yaml
github:
  token: $(gh auth token)
  repos:
    - owner: bketelsen
      repo: oneagent
      labels: [dogfood]

agent:
  provider: claude-code
  stallTimeout: 300000
  maxRetries: 1

concurrency:
  max: 1

poll:
  interval: 30000

web:
  port: 3000
  enabled: true
```

**Step 2: Verify config parses**

Run: `node -e "import('yaml').then(y => console.log(JSON.stringify(y.parse(require('fs').readFileSync('oneagent.yaml','utf8')), null, 2)))"`
Expected: JSON output showing `github.repos[0].repo` is `"oneagent"` and `labels` is `["dogfood"]`

**Step 3: Commit**

```bash
git add oneagent.yaml
git commit -m "chore: point oneagent config at own repo for dogfooding"
```

---

### Task 2: Create the `dogfood` label on the repo

**Step 1: Create the label**

Run: `gh label create dogfood --repo bketelsen/oneagent --description "Issues for oneagent to work on (dogfooding)" --color "D4C5F9"`

Expected: Label created (or "already exists" if it was previously created)

---

### Task 3: Create Wave 1 GitHub issues

**Step 1: Create issue — config loader test coverage**

```bash
gh issue create --repo bketelsen/oneagent \
  --label dogfood \
  --title "Add missing test coverage for config loader" \
  --body "$(cat <<'EOF'
## Summary

Review and expand test coverage for `src/config/loader.ts`. The test file exists at `src/config/__tests__/loader.test.ts` but coverage may be incomplete.

## Requirements

- Identify untested code paths in `src/config/loader.ts`
- Add tests for edge cases: missing file, invalid YAML, missing required fields, token resolution
- Use TDD approach: write failing tests first, then verify existing code passes them
- Run: `npx vitest run src/config/__tests__/loader.test.ts`

## Acceptance Criteria

- All branches in `loader.ts` have test coverage
- All tests pass
- No changes to `loader.ts` unless a bug is found
EOF
)"
```

**Step 2: Create issue — JSDoc comments**

```bash
gh issue create --repo bketelsen/oneagent \
  --label dogfood \
  --title "Add JSDoc comments to AgentDef interface and graph.ts exports" \
  --body "$(cat <<'EOF'
## Summary

Add JSDoc documentation to the `AgentDef` interface and exported functions in `src/agents/graph.ts`.

## Requirements

- Add JSDoc to the `AgentDef` interface in `src/agents/graph.ts` (lines 8-13) describing each field
- Add JSDoc to the `buildAgentGraph()` function explaining what it returns and how agents are organized
- Follow existing code style — concise, not verbose

## Acceptance Criteria

- All exports in `src/agents/graph.ts` have JSDoc comments
- TypeScript still compiles: `npm run build`
- No functional changes
EOF
)"
```

**Step 3: Create issue — .oneagent/skills PR formatting**

```bash
gh issue create --repo bketelsen/oneagent \
  --label dogfood \
  --title "Create .oneagent/skills/ directory with a PR formatting skill" \
  --body "$(cat <<'EOF'
## Summary

Set up the `.oneagent/skills/` directory in this repo with a PR formatting skill so that future agent runs discover and follow consistent PR conventions.

## Requirements

- Create `.oneagent/skills/pr-format.md` with frontmatter (name, description) and instructions for how PRs should be formatted when working on this repo
- PR format should include: conventional commit style title, summary section, test plan section, link back to the issue
- Create `.oneagent/instructions.md` with basic repo conventions (TypeScript, vitest, npm scripts)
- Verify the discover_repo_context tool can find these files

## Acceptance Criteria

- `.oneagent/skills/pr-format.md` exists with valid frontmatter
- `.oneagent/instructions.md` exists with repo conventions
- Files follow the format expected by `src/tools/repo-context.ts`
EOF
)"
```

**Step 4: Create issue — health check endpoint**

```bash
gh issue create --repo bketelsen/oneagent \
  --label dogfood \
  --title "Add a health check endpoint to the web server" \
  --body "$(cat <<'EOF'
## Summary

Add a `GET /health` endpoint to the Hono web server that returns basic health status.

## Requirements

- Add a `/health` route in `src/web/routes/api.ts` (or a new routes file if cleaner)
- Return JSON: `{ "status": "ok", "uptime": <seconds>, "version": "<from package.json>" }`
- Add a test in `src/web/__tests__/` that verifies the endpoint
- Use TDD: write the failing test first

## Acceptance Criteria

- `GET /health` returns 200 with the expected JSON shape
- Test exists and passes: `npx vitest run src/web/__tests__/`
- `npm run build` succeeds
EOF
)"
```

**Step 5: Create issue — poll interval minimum validation**

```bash
gh issue create --repo bketelsen/oneagent \
  --label dogfood \
  --title "Config schema should validate that poll.interval is at least 5000ms" \
  --body "$(cat <<'EOF'
## Summary

The config schema in `src/config/schema.ts` allows arbitrarily small `poll.interval` values. Add a minimum of 5000ms to prevent accidental API rate limiting.

## Requirements

- In `src/config/schema.ts`, change the `interval` field in `pollSchema` to use `.min(5000)`
- Also add `.min(5000)` to `reconcileInterval`
- Add tests in `src/config/__tests__/schema.test.ts` that verify:
  - Valid intervals (>= 5000) are accepted
  - Invalid intervals (< 5000) are rejected with a clear error
- Use TDD: write failing tests first

## Acceptance Criteria

- `poll.interval` and `poll.reconcileInterval` reject values below 5000
- Tests exist and pass: `npx vitest run src/config/__tests__/schema.test.ts`
- `npm run build` succeeds
EOF
)"
```

**Step 6: Verify all issues were created**

Run: `gh issue list --repo bketelsen/oneagent --label dogfood`
Expected: 5 open issues with the `dogfood` label
