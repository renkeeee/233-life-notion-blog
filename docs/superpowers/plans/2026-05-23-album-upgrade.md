# Album Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade Album into a manageable album system backed by `album_items`, collections, admin management, manual uploads, filtering, pagination, and basic EXIF support.

**Architecture:** Keep `post_media` as the article-sync source table and add `album_items` as the public/admin presentation table. Public `/api/album` reads `album_items`; sync upserts auto-derived items without overwriting manual fields. Admin APIs manage item metadata, visibility, collections, batch actions, and manual uploads.

**Tech Stack:** React 19, React Router, TypeScript, Cloudflare Workers, D1, R2, Vitest, current Markdown/CSS stack.

---

## File Structure

- Create `migrations/0011_album_items.sql`: album tables and backfill.
- Modify `workers/db/schema.sql`: canonical schema.
- Modify `workers/types.ts`: public/admin album types.
- Modify `workers/db/d1.ts`: album listing and public query methods.
- Modify `workers/sync.ts`: upsert album items after replacing `post_media`.
- Modify `workers/api/public.ts`: paginated `/api/album` and `/api/album/collections`.
- Modify `workers/api/admin.ts`: admin album item, collection, upload, and batch routes.
- Modify `app/components/admin/AdminShell.tsx`: add Album tab.
- Modify `app/routes/admin.tsx`: render Album panel.
- Create `app/components/admin/AlbumPanel.tsx`: admin album management UI.
- Modify `app/routes/album.tsx`: public pagination, filters, collections, map view, richer metadata.
- Modify `app/app.css`: public and admin album styles.
- Modify/add tests in `tests/schema.test.ts`, `tests/sync.test.ts`, `tests/public-api.test.ts`, `tests/admin-auth-flow.test.ts`, `tests/admin-ui.test.tsx`, and `tests/album.test.tsx`.

## Task 1: Schema and Backfill

- [ ] Write failing schema tests expecting `album_items`, `album_collections`, and `album_item_collections`.
- [ ] Add migration `0011_album_items.sql`.
- [ ] Update `workers/db/schema.sql`.
- [ ] Run `npm test -- tests/schema.test.ts`.

## Task 2: Public Album Repository and API

- [ ] Write failing public API tests for `/api/album?page=1&limit=1`, `hasMore`, collection filters, and hidden/locked post exclusions.
- [ ] Add album query methods in `workers/db/d1.ts`.
- [ ] Update `workers/api/public.ts` to read `album_items`.
- [ ] Keep legacy field names (`postId`, `postSlug`, `postTitle`, `caption`, `publishedAt`, `updatedAt`) for frontend compatibility.
- [ ] Run `npm test -- tests/public-api.test.ts`.

## Task 3: Sync Upsert

- [ ] Write failing sync tests proving post media creates album items and manual metadata is preserved.
- [ ] Add sync code to upsert `album_items` from replaced `post_media`.
- [ ] Ensure hidden album items remain hidden after force sync.
- [ ] Run `npm test -- tests/sync.test.ts`.

## Task 4: Admin Album API

- [ ] Write failing admin API tests for list, edit, hide, restore, delete, batch action, collection CRUD, and upload.
- [ ] Implement admin routes in `workers/api/admin.ts`.
- [ ] Add shared validation helpers for dates, coordinates, slug, visibility, and upload file type.
- [ ] Implement R2 upload using content-addressed keys and existing CDN URL style.
- [ ] Add basic JPEG EXIF extraction for date/GPS where feasible.
- [ ] Run `npm test -- tests/admin-auth-flow.test.ts`.

## Task 5: Admin Album UI

- [ ] Write failing admin UI tests for Album tab, filters, edit dialog, collection dialog, batch actions, and upload form.
- [ ] Create `AlbumPanel`.
- [ ] Add Album tab routing in admin shell.
- [ ] Add CSS for album admin grid/table and dialogs.
- [ ] Run `npm test -- tests/admin-ui.test.tsx`.

## Task 6: Public Album UI

- [ ] Write failing public UI tests for paginated album loading, filters, collection switcher, featured filter, preview metadata, and map view.
- [ ] Update `app/routes/album.tsx` to use paginated API.
- [ ] Add filter toolbar and load-more behavior.
- [ ] Add collection switcher and map/list view toggle.
- [ ] Use `thumbnailUrl` for card images and `largeUrl || url` for preview.
- [ ] Run `npm test -- tests/album.test.tsx`.

## Task 7: Full Verification

- [ ] Run `git diff --check`.
- [ ] Run `npm test`.
- [ ] Run `npm run check`.
- [ ] Summarize completed scope and any limitations.
