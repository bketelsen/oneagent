---
name: readme-maintenance
description: Ensures README.md stays current with new features and changes
---

After completing your changes, check whether they introduce any of the following:

- New features or capabilities
- New API endpoints or routes
- New configuration options (in `oneagent.yaml` or environment variables)
- New CLI commands or flags
- Database schema changes or new migrations
- New dependencies or tools

If **any** of the above apply, update `README.md` to document them:

1. Find the relevant existing section in README.md (e.g., Configuration, Usage, API, etc.)
2. Add a concise description (1-2 sentences) of the new item in that section
3. Follow the existing style, formatting, and heading hierarchy already used in the README
4. Only update sections directly related to your changes — do **not** rewrite or reorganize unrelated sections
5. If no suitable section exists, add a new section at an appropriate location using the same heading style

### Examples

- Added a new CLI flag `--dry-run` → update the **Usage** or **CLI** section with a bullet describing the flag
- Added a new config option `prReview.maxRetries` → update the **Configuration** section
- Added a new `/api/health` endpoint → update the **API** section
- Added a new database migration → mention the schema change in the relevant section

### When NOT to update README

- Pure refactors with no user-facing changes
- Internal test additions
- Bug fixes that don't change behavior or usage
- Code style or formatting changes
