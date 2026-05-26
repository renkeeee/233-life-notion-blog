# Simplify Notion Post Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Physically remove unused post metadata fields while keeping `cover_url` populated from the Notion page cover.

**Architecture:** Keep the local post model focused on title, slug, status, visibility, publish date, page cover, and content. D1 drops `summary` and `tags_json`; public API and React views stop returning or rendering summaries and tags. Sync ignores mapped cover fields and always caches the Notion page-level cover when present.

**Tech Stack:** Cloudflare Workers, D1 SQL migrations, R2 asset caching, React, Vitest.

---

### Task 1: Lock Schema And Public Contract

**Files:**
- Modify: `tests/schema.test.ts`
- Modify: `tests/public-api.test.ts`
- Modify: `tests/sync.test.ts`
- Modify: `tests/notion-mapping.test.ts`

- [ ] **Step 1: Write failing schema tests**

Assert current schema has `cover_url`, does not have `summary` or `tags_json`, and applying `migrations/0001_initial.sql` then `migrations/0002_simplify_post_metadata.sql` leaves the final `posts` columns matching `workers/db/schema.sql`.

- [ ] **Step 2: Write failing public API tests**

Update public summary/detail expectations to include `coverUrl` but exclude `summary` and `tags`; remove tag-count and tag-filter expectations; search expectations should bind title and Markdown patterns only.

- [ ] **Step 3: Write failing sync tests**

Assert `mapNotionPageToPostMetadata` returns a cover from `page.cover`, does not return summary/tags, falls back to page title for slug, and stores the cached CDN cover URL in `posts.cover_url`.

- [ ] **Step 4: Write failing Notion mapping tests**

Assert inferred mappings only include `title`, `status`, and optional `publishedAt`; summary, tags, and cover properties are ignored.

- [ ] **Step 5: Run tests to verify RED**

Run: `npm test -- tests/schema.test.ts tests/public-api.test.ts tests/sync.test.ts tests/notion-mapping.test.ts`

Expected: FAIL because production code still references removed metadata fields.

### Task 2: Simplify Storage And Repositories

**Files:**
- Modify: `workers/db/schema.sql`
- Create: `migrations/0002_simplify_post_metadata.sql`
- Modify: `workers/db/d1.ts`
- Modify: `workers/types.ts`

- [ ] **Step 1: Update current schema**

Remove `summary TEXT` and `tags_json TEXT NOT NULL DEFAULT '[]'` from `posts`; keep `cover_url TEXT`.

- [ ] **Step 2: Add migration**

Create `posts_new`, copy all retained columns, drop old `posts`, rename `posts_new`, and recreate `idx_posts_visibility_published_at` plus `idx_posts_notion_last_edited_time`.

- [ ] **Step 3: Update repository model**

Select/map only `id`, `slug`, `title`, `cover_url`, `status`, `visibility`, `published_at`, and `updated_at`; search title and `post_content.markdown` only; remove tag filtering and `tagCounts`.

- [ ] **Step 4: Update public types**

Remove `summary` and `tags` from `PublicPostRecord`; remove `summary`, `tags`, and `cover` from `FieldMapping`.

- [ ] **Step 5: Run targeted tests**

Run: `npm test -- tests/schema.test.ts tests/public-api.test.ts`

Expected: PASS.

### Task 3: Simplify Notion Mapping And Sync

**Files:**
- Modify: `workers/notion/database.ts`
- Modify: `workers/settings.ts`
- Modify: `workers/sync.ts`
- Modify: `app/components/admin/SettingsPanel.tsx`

- [ ] **Step 1: Reduce inferred and editable mappings**

Infer and edit only `title`, `status`, and optional `publishedAt`. Keep slug generation local from the title.

- [ ] **Step 2: Use Notion page cover**

Set metadata `coverUrl` from `page.cover` only. When present, download/cache it through the existing R2 asset path and store the CDN URL in `posts.cover_url`.

- [ ] **Step 3: Update defaults**

Use the new Notion database URL and ID as admin defaults.

- [ ] **Step 4: Run targeted tests**

Run: `npm test -- tests/sync.test.ts tests/notion-mapping.test.ts tests/settings.test.ts tests/admin-auth-flow.test.ts`

Expected: PASS.

### Task 4: Simplify Public UI

**Files:**
- Modify: `app/components/public/PostList.tsx`
- Modify: `app/components/public/PostDetail.tsx`
- Modify: `app/routes/home.tsx`
- Modify: `app/routes/search.tsx`
- Modify: `app/App.tsx`
- Delete: `app/routes/tag.tsx`
- Modify: `app/app.css`

- [ ] **Step 1: Remove summary and tag rendering**

Keep titles, dates, page cover images, and Markdown content. Remove tag routes and tag CSS.

- [ ] **Step 2: Run frontend checks**

Run: `npm run typecheck && npm run check`

Expected: PASS.

### Task 5: Verify

**Files:**
- No new files.

- [ ] **Step 1: Run all automated checks**

Run: `npm test && npm run typecheck && npm run check`

Expected: PASS.

- [ ] **Step 2: Browser smoke test**

Start the local dev server and open `/`, `/search`, `/post/<slug>` if seeded data is available, and `/admin`. Confirm pages load without summary/tag UI.
