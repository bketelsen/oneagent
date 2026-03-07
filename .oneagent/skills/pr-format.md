---
name: pr-format
description: Enforces consistent pull request formatting conventions for this repository
---

When creating a pull request for this repository, follow these formatting rules:

## Title

Use **conventional commit** style for the PR title:

```
<type>(<scope>): <short description>
```

Where `type` is one of: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`, `build`.

Examples:
- `feat(agents): add retry logic to coder agent`
- `fix(db): handle migration race condition`
- `docs(readme): update setup instructions`

## Body

Structure the PR body with these sections:

### Summary

A brief description of what this PR does and why. Use bullet points for multiple changes.

### Test Plan

Describe how the changes were tested:
- List commands run (e.g., `npm test`, `npm run build`)
- Mention specific test files added or modified
- Note any manual verification steps

### Issue Link

Always link back to the issue this PR addresses:

```
Closes #<issue-number>
```

## Example PR Body

```markdown
## Summary

- Add retry middleware for transient API failures
- Configure exponential backoff with max 3 attempts

## Test Plan

- [x] `npm test` passes
- [x] Added `src/middleware/__tests__/retry.test.ts`
- [x] Verified retry behavior with mock server

Closes #42
```
