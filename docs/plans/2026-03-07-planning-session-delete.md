# Planning Session Delete/Archive Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add delete buttons to planning sessions — "Delete" for unpublished, "Archive" for published — both hard-delete the session row from SQLite.

**Architecture:** Add `delete(id)` to `PlanningRepo`, a `POST /planning/:id/delete` route, and delete buttons on both the list and detail pages with `confirm()` dialogs.

**Tech Stack:** TypeScript, Hono JSX, better-sqlite3, Vitest

---

### Task 1: Add `delete()` method to PlanningRepo

**Files:**
- Modify: `src/db/planning.ts:39-105`
- Test: `src/db/__tests__/planning.test.ts`

**Step 1: Write the failing test**

Add to `src/db/__tests__/planning.test.ts` inside the top-level `describe`:

```typescript
it("deletes a session", () => {
  repo.save("s-del", [{ role: "user", content: "hello" }]);
  expect(repo.list()).toHaveLength(1);
  repo.delete("s-del");
  expect(repo.list()).toHaveLength(0);
  expect(repo.load("s-del")).toEqual([]);
});

it("delete is a no-op for nonexistent session", () => {
  expect(() => repo.delete("nonexistent")).not.toThrow();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/__tests__/planning.test.ts`
Expected: FAIL — `repo.delete is not a function`

**Step 3: Write minimal implementation**

Add to `PlanningRepo` class in `src/db/planning.ts`, after the `loadContext` method (before the closing `}`):

```typescript
delete(id: string): void {
  this.db.prepare("DELETE FROM planning_sessions WHERE id = ?").run(id);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db/__tests__/planning.test.ts`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/db/planning.ts src/db/__tests__/planning.test.ts
git commit -m "feat: add delete method to PlanningRepo"
```

---

### Task 2: Add POST `/planning/:id/delete` route

**Files:**
- Modify: `src/web/routes/planning.tsx:116-264`

**Step 1: Add the delete route**

Add after the `route.get("/:id/plan", ...)` handler (before `return route;` at line 263):

```typescript
route.post("/:id/delete", (c) => {
  const id = c.req.param("id");
  ctx.planningRepo.delete(id);
  return c.redirect("/planning");
});
```

**Step 2: Run tests to verify nothing broke**

Run: `npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/web/routes/planning.tsx
git commit -m "feat: add POST /planning/:id/delete route"
```

---

### Task 3: Add delete/archive buttons to the list page

**Files:**
- Modify: `src/web/routes/planning.tsx:136-156` (the session list rendering)

**Step 1: Add button to each session row**

Replace the session list item `<a>` block (lines 138-155) with a structure that includes the delete button. The key change: wrap each row in a `<div>` with flex layout, keeping the `<a>` for navigation and adding a form for deletion.

Replace:
```tsx
<a href={`/planning/${s.id}`} class="block bg-gray-100 dark:bg-gray-800 rounded p-4 hover:bg-gray-200 dark:hover:bg-gray-700">
  <div class="flex justify-between items-center">
    <div class="font-medium">{s.id.slice(0, 8)}...</div>
    <div class="flex gap-2 items-center">
      {s.repo && (
        <span class="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">{s.repo}</span>
      )}
      {s.status && (
        <span class={`text-xs px-2 py-0.5 rounded ${
          s.status === "published" ? "bg-green-900 text-green-300" :
          s.status === "approved" ? "bg-blue-900 text-blue-300" :
          "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
        }`}>{s.status}</span>
      )}
    </div>
  </div>
  <div class="text-gray-400 dark:text-gray-500 text-sm">{s.issueKey ?? "No issue"} — {s.updatedAt}</div>
</a>
```

With:
```tsx
<div class="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700">
  <a href={`/planning/${s.id}`} class="flex-1 p-4">
    <div class="flex justify-between items-center">
      <div class="font-medium">{s.id.slice(0, 8)}...</div>
      <div class="flex gap-2 items-center">
        {s.repo && (
          <span class="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300">{s.repo}</span>
        )}
        {s.status && (
          <span class={`text-xs px-2 py-0.5 rounded ${
            s.status === "published" ? "bg-green-900 text-green-300" :
            s.status === "approved" ? "bg-blue-900 text-blue-300" :
            "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
          }`}>{s.status}</span>
        )}
      </div>
    </div>
    <div class="text-gray-400 dark:text-gray-500 text-sm">{s.issueKey ?? "No issue"} — {s.updatedAt}</div>
  </a>
  <form method="post" action={`/planning/${s.id}/delete`} class="pr-4"
    onsubmit={`return confirm('Are you sure you want to ${s.status === "published" ? "archive" : "delete"} this planning session? This cannot be undone.')`}>
    <button type="submit" class="text-xs px-2 py-1 rounded bg-red-900 text-red-300 hover:bg-red-800">
      {s.status === "published" ? "Archive" : "Delete"}
    </button>
  </form>
</div>
```

**Step 2: Run tests to verify nothing broke**

Run: `npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/web/routes/planning.tsx
git commit -m "feat: add delete/archive buttons to planning list page"
```

---

### Task 4: Add delete/archive button to the detail page

**Files:**
- Modify: `src/web/routes/planning.tsx:172-229` (the session detail view)

**Step 1: Add button to the detail page header**

In the `route.get("/:id", ...)` handler, add a delete button next to the heading. Replace:

```tsx
<h1 class="text-xl font-bold mb-1">Planning Session</h1>
```

With:

```tsx
<div class="flex justify-between items-center mb-1">
  <h1 class="text-xl font-bold">Planning Session</h1>
  <form method="post" action={`/planning/${id}/delete`}
    onsubmit={`return confirm('Are you sure you want to ${plan?.status === "published" ? "archive" : "delete"} this planning session? This cannot be undone.')`}>
    <button type="submit" class="text-xs px-3 py-1 rounded bg-red-900 text-red-300 hover:bg-red-800">
      {plan?.status === "published" ? "Archive" : "Delete"}
    </button>
  </form>
</div>
```

**Step 2: Run tests to verify nothing broke**

Run: `npx vitest run`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/web/routes/planning.tsx
git commit -m "feat: add delete/archive button to planning detail page"
```
