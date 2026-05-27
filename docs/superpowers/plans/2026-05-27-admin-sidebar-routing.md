# Admin Sidebar Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the admin console to a left-sidebar layout with URL-backed sections.

**Architecture:** Keep `/admin/*` as the lazy-loaded admin entry, then route inside `app/routes/admin.tsx` with nested `Routes`. `AdminShell` becomes a presentational two-column shell with React Router links.

**Tech Stack:** React, React Router, Vitest, Testing Library, existing CSS.

---

### Task 1: Route Admin Sections

**Files:**
- Modify: `app/routes/admin.tsx`
- Modify: `app/components/admin/AdminShell.tsx`
- Test: `tests/admin-ui.test.tsx`

- [ ] Replace `activeTab` state with nested `Routes` and `Navigate`.
- [ ] Render overview, settings, sync, posts, and album from URL paths.
- [ ] Update `AdminShell` to render links instead of buttons.
- [ ] Add tests for `/admin` redirect and direct `/admin/settings`.

### Task 2: Sidebar Styling

**Files:**
- Modify: `app/app.css`
- Test: `tests/admin-ui.test.tsx`

- [ ] Replace top tab styling with `.admin-layout`, `.admin-sidebar`, `.admin-main`, and `.admin-side-nav`.
- [ ] Keep the existing module/card styling untouched.
- [ ] Add responsive behavior for narrow screens.
- [ ] Add a test assertion for the two-column shell class.

### Task 3: Verification

**Files:**
- Test only.

- [ ] Run `npm test -- tests/admin-ui.test.tsx`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
