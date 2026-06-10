# Post Sections Design

## Goal

Add manually managed post sections to the blog. Sections appear in the public header between Home and Album, have their own top-level URL path, and filter the home-style post list. Home shows only posts without a section.

## Data Model

Create a `post_sections` table with `id`, `name`, `slug`, `sort_order`, `created_at`, and `updated_at`. Add nullable `posts.section_id` referencing `post_sections(id)` with `ON DELETE SET NULL`.

Existing posts default to no section. Notion sync and manual post publishing preserve the current `section_id`; section assignment is managed only from the blog admin.

Section slugs use lower-case letters, numbers, and hyphens. They must be unique and cannot use reserved top-level paths such as `admin`, `album`, `archive`, `search`, `post`, `demo`, `api`, `rss.xml`, `sitemap.xml`, or `robots.txt`.

## Admin Behavior

The Posts admin page adds a "Section settings" control beside "Comment settings". Opening it shows an inline settings panel where the admin can create, rename, edit slugs, reorder, and delete sections. New sections append to the end of the navigation order.

Deleting a section with assigned posts requires confirmation. Confirmed deletion moves those posts back to no section, then deletes the section.

Each post management dialog adds a Section selector. The default option is "No section". Changing it updates only that post's section assignment.

## Public Behavior

The public header renders Home, then each section sorted by `sort_order`, then Album and Archived.

Routes:

- `/` lists published visible posts with no section.
- `/<section-slug>` lists published visible posts assigned to that section.
- `/album`, `/archive`, `/search`, `/post/:slug`, `/demo`, `/admin`, and API paths keep their existing behavior.

Search and archive remain global. Category and tag filters on Home or a section page filter inside the current scope.

## API Shape

Public:

- `GET /api/post-sections` returns sections sorted for navigation.
- `GET /api/posts` returns no-section posts by default.
- `GET /api/posts?section=<slug>` returns posts for that section or `404` when the section slug does not exist.
- `GET /api/categories` and `GET /api/tags` accept the same optional `section` parameter for scoped filter menus.

Admin:

- `GET /api/admin/post-sections`
- `POST /api/admin/post-sections`
- `PUT /api/admin/post-sections/:id`
- `POST /api/admin/post-sections/:id/move`
- `DELETE /api/admin/post-sections/:id?movePosts=none`
- `PUT /api/admin/posts/:id/section`

## Errors

Invalid, duplicate, or reserved slugs return `BAD_REQUEST`. Missing sections and posts return `NOT_FOUND`. Deleting a non-empty section without confirmation returns `CONFLICT` and the assigned post count.

## Verification

Tests cover schema migration, public section filtering, admin section CRUD, post assignment, UI controls, and sync preservation. Final verification runs typecheck, tests, lint/check, and Playwright visual inspection for public and admin-facing layouts.
