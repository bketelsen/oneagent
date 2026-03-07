# Custom Agent Skills & Repo Instruction Discovery

## Problem

When oneagent dispatches a coding agent to work on a GitHub issue, the agent has no awareness of project-specific conventions, instructions, or skills defined in the target repository. Repos may contain instruction files (CLAUDE.md, AGENTS.md, copilot instructions) that should steer agent behavior.

## Decision: Two Layers

- **Context layer**: Instruction files (CLAUDE.md, AGENTS.md, etc.) are discovered and injected into the coder agent's prompt as additional context.
- **Skill layer**: Custom skills in `.oneagent/skills/*.md` are markdown files with frontmatter that also get injected as prompt context.

Both layers use prompt injection (not handoff agents). The LLM follows the instructions as part of its system prompt, without separate agent handoffs.

## Instruction File Discovery

The tool scans the repo root for known instruction files in this order:

| File | Source |
|------|--------|
| `CLAUDE.md` | Claude Code |
| `AGENTS.md` | Generic agent instructions |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.cursorrules` | Cursor |

All discovered files are included with a source header. No deduplication — the repo maintainer is responsible for consistency.

Output format:
```
## Repository Instructions (from CLAUDE.md)
<contents>

## Repository Instructions (from AGENTS.md)
<contents>
```

## Custom Skills Format

Skills live in `.oneagent/skills/*.md` with YAML frontmatter:

```markdown
---
name: django-expert
description: Django conventions and patterns for this project
---

When working with this codebase, follow these Django conventions:
- Always use class-based views
- Run migrations with `python manage.py migrate --check` before committing
```

Required frontmatter: `name`, `description`.

Output format:
```
## Custom Skill: django-expert
Django conventions and patterns for this project

<body contents>
```

## The `discover_repo_context` Tool

New file: `src/tools/repo-context.ts`

- **Input:** `{ workingDir: string }` — the repo root path
- **Behavior:**
  1. Scan for instruction files — read each if present
  2. Scan `.oneagent/skills/` for `*.md` files — parse frontmatter + body
  3. Return a single normalized markdown string combining both sections
- **Output:** Concatenated, labeled markdown. Empty sections omitted.

The coder prompt (`src/agents/prompts.ts`) is updated to tell the agent to call this tool after entering the repo.

The tool is registered alongside existing tools (github, planning, workspace) in the agent graph.

## Approach

Tool-based discovery (Approach 2). The agent calls `discover_repo_context` after cloning/entering the repo. This keeps the dispatch flow unchanged and gives us a clean, testable normalization point.

Future iteration: handoff-based skills (where custom skills become separate agents in the handoff graph) can be added later if demand warrants it.

## Testing Strategy

**Unit tests** (`src/tools/__tests__/repo-context.test.ts`):
- Temp directories with various instruction file combinations
- Frontmatter parsing: valid, invalid, missing
- Output format verification
- Edge cases: empty skills dir, no files, malformed markdown

**Integration test** (`src/tools/__tests__/repo-context.integration.test.ts`):
- Fixture repo with CLAUDE.md, AGENTS.md, and a custom skill
- Call the tool, assert output contains all sources properly labeled
- Verify the assembled coder prompt includes the discovered context

**Functional test** (`src/tools/__tests__/repo-context.functional.test.ts`):
- Build full agent graph with custom skills from fixture repo
- Assert coder agent's prompt includes discovered context
- Assert tool is registered and callable
- Verify empty repo produces clean "no context found" result

No real LLM calls — tests verify the plumbing assembles and delivers context correctly.
