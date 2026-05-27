# Comment Management Design

## Goal

Add a dedicated admin comment management experience so the site owner can review, reply to, delete, and configure comments from one place.

The feature adds a settings-page entry point and an `/admin/comments` page. It reuses the existing comment moderation, reply, delete, and settings behavior that currently lives inside post management, while adding a full-site comment list API for the new page.

## Current Context

The app already supports:

- Public post comments with Turnstile submission protection.
- Global comment settings stored in `settings`.
- Per-post `comments_enabled`.
- Comment moderation through `post_comments.moderation_status`.
- Author replies through `reply_body` and `reply_created_at`.
- Existing admin APIs for post-scoped comment list, approval, reply, delete, and per-post comment toggles.
- Existing admin UI in `PostStatusTable` for comment settings and a per-post comments modal.

The missing piece is a first-class, full-site admin workflow for comments. The current workflow requires finding a post first, then opening that post's comments modal.

## Scope

In scope for this iteration:

- Add a comment management entry card to `/admin/settings`.
- Add a sidebar navigation item under the `Settings` group.
- Add `/admin/comments` as a URL-backed admin route.
- Show comment settings at the top of the new page.
- Show a full-site comment list with `Pending`, `Approved`, and `All` views.
- Default the page to the `Pending` view.
- Support keyword search over comment body, nickname, and post title.
- Support pagination and newest-first ordering.
- Support single-comment approve, reply/edit reply, and delete actions.
- Keep the existing `Posts` page comment settings and per-post comments modal working.

Out of scope for this iteration:

- Batch approval or batch delete.
- Removing or redesigning the existing post-scoped comments modal.
- New public comment behavior.
- Notification emails or webhooks.
- Spam scoring or automated moderation.

## Navigation

Authenticated admin routes become:

- `/admin/comments`: dedicated comment management page.
- `/admin/settings`: still shows password and data source settings, plus a comment management entry card.

`AdminShell` adds a `Comments` item under the existing `Settings` group. The settings page also renders a prominent entry card titled `Comment management` linking to `/admin/comments`.

The entry should respect the existing admin language and visual style. Since the current admin UI uses English labels, this iteration uses English labels rather than mixing localized copy into the admin shell.

## Page Structure

The `/admin/comments` page has two main sections.

### Comment Settings

The top section reuses the existing global comment settings:

- Allow new comments across all posts.
- Enable comments for newly synced posts.
- Review comments before publishing.

It uses the existing `/api/admin/posts/comment-settings` endpoint for load and save. The same disabled and error states used in post management should be preserved where applicable.

### Comment List

The list section has three views:

- `Pending`: default view; shows only comments with `moderationStatus = "pending"`.
- `Approved`: shows only comments with `moderationStatus = "approved"`.
- `All`: shows pending and approved comments.

The list supports:

- Search input for comment body, nickname, and post title.
- Apply-search action.
- Pagination controls.
- Newest-first ordering by comment creation time.

Each list item displays:

- Comment status.
- Nickname, with the existing anonymous fallback.
- Comment body.
- Post title, linked to the public post when a slug is present.
- Created time.
- Existing author reply summary, if present.
- Reply created time, if present.

Each item supports:

- Approve, only shown for pending comments.
- Reply or edit reply.
- Delete.

Deletion is permanent and follows the current admin delete behavior.

## API Design

Add:

`GET /api/admin/comments`

Query parameters:

- `status=pending|approved|all`
- `q=<keyword>`
- `page=<positive integer>`
- `limit=<positive integer>`

Default behavior:

- `status=pending`
- `page=1`
- `limit=20`
- Order by `post_comments.created_at DESC`

Response shape:

```json
{
  "items": [
    {
      "id": "comment-1",
      "nickname": "Ada",
      "body": "A thoughtful note.",
      "moderationStatus": "pending",
      "replyBody": null,
      "replyCreatedAt": null,
      "createdAt": "2026-05-27T00:00:00.000Z",
      "post": {
        "id": "post-1",
        "title": "Hello World",
        "slug": "hello-world",
        "commentsEnabled": true
      }
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

The endpoint requires the same usable admin session checks as existing protected admin APIs. Initial-password sessions should receive the existing password-change-required response.

Single-comment mutations should reuse the existing post-scoped endpoints:

- `PUT /api/admin/posts/:postId/comments/:commentId`
- `DELETE /api/admin/posts/:postId/comments/:commentId`

Because the list API returns `post.id`, the frontend can call the existing mutation endpoints without adding duplicate mutation routes in the first version.

## Data Flow

On page load:

1. Fetch comment settings from `/api/admin/posts/comment-settings`.
2. Fetch `/api/admin/comments?status=pending&page=1&limit=20`.
3. Render the settings section and pending comments list independently so one failed request does not hide the other section.

On view change:

1. Update the selected view.
2. Reset page to 1.
3. Fetch comments with the selected status and current keyword.

On search:

1. Apply the entered keyword.
2. Reset page to 1.
3. Fetch comments with the selected status and keyword.

On approve:

1. Call the existing post-scoped `PUT` endpoint with `{ "moderationStatus": "approved" }`.
2. Replace the updated comment in local state.
3. If the current view is `Pending`, remove the approved comment from the visible list.

On reply:

1. Call the existing post-scoped `PUT` endpoint with `{ "replyBody": "<text>" }`.
2. Replace the updated comment in local state.
3. Keep the item visible in the current view.

On delete:

1. Call the existing post-scoped `DELETE` endpoint.
2. Remove the deleted comment from the current list.

## Error Handling

Use existing admin error patterns:

- Show section-level loading states.
- Show inline errors for failed settings load/save.
- Show inline errors for failed comment list load.
- Keep the existing list visible when a mutation fails.
- Disable only the item action that is currently pending.
- Show the existing admin toast pattern for successful settings save, approve, reply save, and delete.

## Testing

Backend tests should cover:

- Unauthenticated access to `GET /api/admin/comments`.
- Password-change-required access to `GET /api/admin/comments`.
- Default pending filter.
- `approved` and `all` filters.
- Keyword search across body, nickname, and post title.
- Pagination metadata and limit behavior.
- Response includes post id, title, slug, and comments enabled state.

Frontend tests should cover:

- `/admin/settings` renders a comment management entry linking to `/admin/comments`.
- Sidebar renders the `Comments` navigation item under `Settings`.
- Direct navigation to `/admin/comments` renders the comment management page.
- The page defaults to `Pending`.
- Switching tabs requests pending, approved, and all statuses.
- Search applies the keyword and resets pagination.
- Approving a pending comment calls the existing post-scoped mutation endpoint and removes it from the pending view.
- Saving a reply calls the existing post-scoped mutation endpoint and updates the rendered reply.
- Deleting a comment calls the existing post-scoped delete endpoint and removes it from the list.
- Saving comment settings uses the existing comment settings endpoint.
- Existing `Posts` page comment modal tests continue to pass.

## Acceptance Criteria

- The settings page contains a clear comment management entry.
- The sidebar contains a direct comment management navigation item.
- `/admin/comments` defaults to pending comments.
- The comment list can switch between pending, approved, and all views.
- The comment list can be searched by body, nickname, or post title.
- The comment list paginates newest-first results.
- Pending comments can be approved.
- Comments can receive new or edited author replies.
- Comments can be permanently deleted.
- Global comment settings can be loaded and saved from the new page.
- Existing post management comment behavior remains intact.
