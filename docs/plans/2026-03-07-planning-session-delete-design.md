# Planning Session Delete/Archive

## Summary

Add the ability to delete planning sessions from the UI. Published sessions show an "Archive" button; unpublished sessions show a "Delete" button. Both perform a hard delete of the session row from SQLite. GitHub issues created from published sessions are left untouched.

## Database Layer

Add a `delete(id: string)` method to `PlanningRepo` that runs `DELETE FROM planning_sessions WHERE id = ?`.

## API

- **POST `/planning/:id/delete`** — Deletes the session row, redirects to `/planning`.

Uses POST with a form rather than HTTP DELETE for HTML form compatibility.

## UI

### List page (`GET /planning`)

Each session row gets a small red button:
- **Unpublished sessions:** labeled "Delete"
- **Published sessions:** labeled "Archive"

Both trigger a `confirm()` dialog before submitting the form.

### Detail page (`GET /planning/:id`)

Same button in the header/toolbar area with the same label logic and confirmation.

## No migration needed

This is a delete-only feature — no schema changes required.
