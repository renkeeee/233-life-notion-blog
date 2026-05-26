# Native Post Authoring Design

## Goal

Add first-party post authoring to the admin console so posts can be created, drafted, edited, published, and uploaded directly from the website. This feature is local-only: it does not write back to Notion, and Notion sync must never overwrite locally authored posts.

The first implementation focuses on a stable writing flow:

- local-only posts;
- Markdown editor, not a code editor;
- draft first, publish explicitly;
- image upload to R2;
- uploaded images automatically appear in Album;
- public pages continue using the existing post, RSS, archive, search, category, tag, lock, hide, and comments behavior.

## Confirmed Decisions

- Local posts are stored in the service database only.
- Notion-synced posts are read-only in the website editor.
- Publishing uses a `draft -> publish` flow.
- The editor uses MDXEditor as an open-source Markdown writing editor.
- The first media scope is image upload only.
- Uploaded article images are written to R2 and automatically become visible Album items.
- The data model uses a minimal compatibility path instead of a full `posts` table rebuild.

## Non-Goals

This first version does not include:

- writing local posts back to Notion;
- editing Notion posts in the website editor;
- collaborative editing;
- revision history;
- scheduled publishing;
- video/audio/file uploads from the post editor;
- a full CMS workflow with reviewers and approvals;
- replacing the existing public Markdown rendering chain.

## Architecture

Add local authoring as a second post source.

```text
Notion database
  -> Notion sync
  -> posts/source_type=notion

Admin editor
  -> post_drafts
  -> publish
  -> posts/source_type=local
```

Published local posts reuse the existing public content tables:

- `posts`;
- `post_content`;
- `post_tags`;
- `post_media`;
- `album_items`;
- `comments`.

This keeps public behavior mostly unchanged. Homepage, detail page, Archive, Album, RSS, Sitemap, Search, category filtering, tag filtering, locks, hidden state, deletion, and comments continue to read the same tables.

## Data Model

### `posts` Source Fields

Add source tracking to `posts`:

```sql
ALTER TABLE posts ADD COLUMN source_type TEXT NOT NULL DEFAULT 'notion';
ALTER TABLE posts ADD COLUMN source_id TEXT;
```

Historical rows are backfilled as:

```text
source_type = notion
source_id = notion_page_id
```

Local posts use:

```text
source_type = local
source_id = <local post uuid>
notion_page_id = local:<local post uuid>
```

The synthetic `notion_page_id` is intentional compatibility glue for the current `posts.notion_page_id NOT NULL UNIQUE` constraint. It avoids a risky D1 table rebuild in this feature.

Local published rows also fill existing required compatibility fields:

```text
status = local
visibility = published
notion_last_edited_time = <draft updated_at or published_at>
content_hash = <markdown/content metadata hash>
```

Local `post_content.block_snapshot_hash` should use a deterministic local hash, such as the same content hash or a `local:<hash>` value, because there is no Notion block snapshot for locally authored content.

### `post_drafts`

Create a draft table:

```sql
CREATE TABLE post_drafts (
  id TEXT PRIMARY KEY,
  post_id TEXT,
  title TEXT NOT NULL,
  slug TEXT,
  excerpt TEXT,
  markdown TEXT NOT NULL,
  cover_url TEXT,
  category TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  comments_enabled INTEGER,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
);
```

`status` values:

- `draft`: not public;
- `published`: draft has been published to `posts`;
- `archived`: retained locally but not an active editing target.

The draft table stores editable authoring state. Public tables store the published state.

## State Flow

### New Local Post

```text
New post
  -> create post_drafts(status=draft)
  -> save changes to post_drafts only
  -> publish
  -> validate
  -> upsert posts/post_content/post_tags/post_media/album_items
  -> set post_drafts.status=published
```

Draft saves never change public pages.

### Edit Published Local Post

```text
Open editor for local post
  -> find existing draft by post_id or create one from posts/post_content
  -> save changes to post_drafts only
  -> publish
  -> replace published local post content
```

This allows editing published posts without changing the live page until publish is clicked again.

### Notion Post

Notion posts never enter the editor. In the admin Posts list:

- Notion rows show existing actions such as resync, comments, lock, hide, and delete.
- Local rows show edit and existing management actions.

## Admin UI

Add local authoring to the existing admin console.

### Posts Tab

Add:

- `New post` action near the Posts controls;
- source-aware actions;
- `Edit` for local posts only;
- no `Edit` action for Notion posts.

The Posts table should keep the current compact action style.

### Editor View

Add an admin editor view for local drafts.

Fields:

- title;
- slug;
- excerpt;
- Markdown body;
- cover URL;
- category;
- tags;
- published date;
- comments enabled;
- image upload.

Actions:

- save draft;
- publish;
- unpublish if already published;
- delete draft;
- return to Posts.

The Markdown body uses MDXEditor. The editor should be configured as a Markdown writing surface, with unnecessary MDX-specific behavior disabled unless needed by the library for base operation.

The public detail page continues rendering saved Markdown with the existing `react-markdown` pipeline.

## Admin API

Add local post APIs:

```text
GET    /api/admin/local-posts/:id
POST   /api/admin/local-posts
PUT    /api/admin/local-posts/:id
POST   /api/admin/local-posts/:id/publish
POST   /api/admin/local-posts/:id/unpublish
DELETE /api/admin/local-posts/:id
POST   /api/admin/uploads
```

Endpoint behavior:

- `POST /api/admin/local-posts` creates a draft and returns its id.
- `GET /api/admin/local-posts/:id` returns draft state.
- `PUT /api/admin/local-posts/:id` saves draft state only.
- `POST /api/admin/local-posts/:id/publish` validates and writes public tables.
- `POST /api/admin/local-posts/:id/unpublish` sets the published local post to `visibility='archived'` while keeping the draft. Public queries already require `visibility='published'`, so the post disappears from public pages without deleting authoring state.
- `DELETE /api/admin/local-posts/:id` deletes the draft. If the draft has a published local post, deletion should require an explicit flag or a separate published-post delete path so accidental live deletion is avoided.
- `POST /api/admin/uploads` uploads images to R2 and returns a CDN URL.

All mutating endpoints require the existing admin session and CSRF protection.

## Validation

Draft save validation is intentionally light:

- title is required;
- slug must have a valid shape when present;
- tags and category may be empty;
- Markdown may be empty, but the UI should make that visible.

Publish validation is strict:

- title is required;
- slug is required;
- slug must be lowercase letters, numbers, and hyphens only;
- slug must be unique across all published posts except the same local post being republished;
- Markdown body is required;
- uploaded image URLs must be valid CDN URLs returned by this service;
- category and tags are normalized before write;
- generated `post_media` and `album_items` writes must succeed.

If publish fails after partial writes, the request should fail as a whole and leave the public post unchanged where possible. D1 transaction usage should be preferred for post/content/tag/media updates.

## Image Upload

First version supports:

- `image/jpeg`;
- `image/png`;
- `image/webp`;
- `image/gif`.

Limits:

- maximum single image size: 10 MB;
- object key uses hash or uuid, not user-provided filename;
- upload result returns CDN URL;
- editor inserts Markdown image syntax.

Example:

```markdown
![cover detail](https://assets.233.life/assets/...)
```

On publish, Markdown image URLs are scanned. Local uploaded images are written to `post_media`. `album_items` are created or updated from those `post_media` rows and default to visible.

Album thumbnails use the existing image transform parameters:

```text
width=440,quality=82,format=auto
```

## Sync Isolation

Notion sync only creates or updates Notion posts.

Rules:

- new Notion rows are inserted with `source_type=notion`;
- historical rows with missing `source_type` are treated as Notion rows;
- rows with `source_type=local` are ignored by all Notion refresh logic;
- single-post resync is available for Notion posts only;
- forced sync still cannot overwrite local posts.

This protects local writing from external sync state.

## Public API Behavior

Public APIs should include local published posts by default because they read from `posts`.

Affected surfaces:

- `GET /api/posts`;
- `GET /api/posts/:slug`;
- search API;
- archive API;
- album API;
- RSS;
- sitemap;
- category and tag APIs.

Where useful, responses may include:

```json
{
  "sourceType": "local"
}
```

The frontend should not need a different renderer for local posts.

## Error Handling

Admin UI should show specific toast messages for:

- slug conflict;
- invalid slug;
- failed image upload;
- unsupported file type;
- oversized image;
- failed draft save;
- failed publish;
- failed unpublish.

API errors should use the existing structured error shape and avoid leaking internal R2, D1, or encryption details.

## Security

- All admin authoring APIs require admin auth.
- Mutations require CSRF checks.
- Uploads validate MIME type and size server-side.
- Uploaded object keys are generated by the server.
- Markdown is still sanitized at render time through the existing public renderer.
- `rehype-raw` support should not be expanded as part of this feature.
- Local posts inherit existing lock, hide, delete, and comments controls.

## Testing Strategy

Add tests for:

- migration adds `source_type/source_id` and `post_drafts`;
- historical posts are treated as Notion source;
- Notion sync ignores `source_type=local`;
- creating a local draft;
- saving a local draft;
- slug validation and slug conflict;
- publishing a draft into `posts/post_content/post_tags`;
- republishing a local post without changing live content during draft save;
- upload validation for file type and size;
- upload writes to R2 and returns CDN URL;
- Markdown image scan creates `post_media`;
- `album_items` are created for uploaded images and are visible by default;
- local published posts appear in homepage, detail, archive, RSS, search, category, and tag APIs;
- Notion posts do not show the editor action;
- local posts show the editor action;
- admin UI save draft, publish, upload image, and error toasts.

## Implementation Order

1. Add migration for `posts.source_type`, `posts.source_id`, and `post_drafts`.
2. Update server post repository helpers to understand source type.
3. Protect Notion sync from local posts.
4. Add local draft admin APIs.
5. Add publish/unpublish logic.
6. Add upload endpoint and R2 image validation.
7. Add Markdown image extraction into `post_media` and `album_items`.
8. Add admin editor route with MDXEditor.
9. Add source-aware actions in Posts admin.
10. Extend tests and run build/deploy verification.
