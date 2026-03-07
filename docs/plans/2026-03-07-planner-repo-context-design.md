# Planner Repo Context Design

**Date:** 2026-03-07
**Status:** Approved

## Problem

The planner agent has no visibility into the repository it's planning for. It only receives three planning tools (`create_plan`, `refine_plan`, `publish_plan`) and no repo context. This forces it to ask basic questions (like "what framework are you using?") that it should already know from CLAUDE.md, README, package.json, etc.

## Solution

Add a repo selection step before creating a planning session, then shallow-clone the selected repo to capture context and inject it into the planner's prompt.

### 1. UI Changes — Repo Selector

Replace the "New Session" button on `/planning` with a form containing:
- A dropdown of configured repos (from `config.github.repos`), each showing `owner/repo`
- A "Start Planning Session" submit button

The session list also shows which repo each session targets (small label next to the session ID).

### 2. Database Changes

Add a new migration with two columns on the planning sessions table:
- `repo` — `TEXT NOT NULL` — stores `owner/repo` (e.g. `bketelsen/oneagent`)
- `repo_context` — `TEXT` — the captured context string

Existing sessions get `repo` defaulted to the first configured repo and `repo_context` as null.

### 3. Session Creation Flow

When the user submits the new session form:

1. POST `/planning/new` receives the selected `owner/repo`
2. Shallow clone into a temp dir: `git clone --depth 1 <repo-url> <tmpdir>`
3. Run `discoverRepoContext(tmpdir)` to get instruction files + custom skills
4. Run a directory listing (`find . -type f` excluding `.git`, `node_modules`, `dist`) capped at ~500 entries
5. Combine into a context string and store in the `repo_context` column
6. Delete the temp dir
7. Redirect to the new session page

Clone URL constructed as `https://github.com/{owner}/{repo}.git`, using token auth for private repos.

### 4. Prompt Injection

In `src/index.ts` where `onChat` builds the prompt, inject the stored `repo_context` between the planner system prompt and the conversation history:

```
[PLANNER_PROMPT]

## Repository Context for {owner}/{repo}

{repo_context}

## Directory Structure

{directory_listing}

IMPORTANT: The current planning session ID is "..."
[conversation history]
User: ...
```

The planner prompt (`PLANNER_PROMPT`) doesn't need changes. It already says "explore existing code affected" in Phase 1 — now it actually can.

## Key Decisions

- **Approach chosen:** Shallow clone + read + delete (Approach A). Simplest, reuses existing `discoverRepoContext()`, guarantees context is always present (no reliance on LLM remembering to call a tool).
- **Context is static:** Captured once at session creation. Fine for planning — repo structure rarely changes mid-session.
- **Reuses existing code:** `discoverRepoContext()` from `src/tools/repo-context.ts` handles CLAUDE.md, AGENTS.md, .cursorrules, .oneagent/skills, etc.
