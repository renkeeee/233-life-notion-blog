# Notion Blog Design

## Goal

Build an API-first blog system backed by a Notion database. Notion remains the source of truth for content, while Cloudflare stores synced Markdown, metadata, asset references, configuration, and sync history.

## Confirmed Decisions

- Use the existing Cloudflare stack: React Router, Cloudflare Workers, D1, R2, and Cron Triggers.
- Do not use server-side rendering for business data. The frontend calls JSON APIs directly.
- Use the official Notion API with a Notion Integration Token.
- Let the admin console read the Notion database schema, infer field mappings, and allow manual correction.
- Publish only entries whose mapped status is `Published` or `已发布`.
- Public blog scope for version one: home post list, post detail, tag archive, and search.
- Store R2 assets by content hash. Forced refreshes redownload and reprocess resources, but identical content is not uploaded twice.
- Allow all configuration to be entered through the admin console, but encrypt sensitive values before storing them in D1.
- Keep `block_snapshot_hash` in `post_content` so sync can distinguish metadata-only changes from body content changes.

## Architecture

The app is a React single-page frontend served by a Cloudflare Worker. Public blog pages and admin pages render on the client and fetch all business data from `/api/*`.

The Worker owns:

- public blog APIs;
- admin authentication and configuration APIs;
- Notion schema inspection;
- manual and scheduled sync orchestration;
- D1 persistence;
- R2 asset upload;
- config encryption and session signing.

Cloudflare Cron runs nightly and calls the same sync service used by manual refresh. Manual refresh accepts an optional time range and a force flag.

## Storage Model

### `settings`

Stores site and integration configuration:

- site title and public display settings;
- Notion database URL and parsed database ID;
- encrypted Notion token;
- encrypted R2/CDN-related sensitive configuration when applicable;
- public CDN domain;
- field mapping JSON;
- sync preferences.

Sensitive values are encrypted before being written to D1. The Worker reads `CONFIG_ENCRYPTION_KEY` from the deployment environment and uses it as the root key for encryption and decryption.

### `posts`

Stores article metadata:

- local ID;
- Notion page ID;
- slug;
- title;
- summary;
- cover URL;
- tags JSON;
- mapped status;
- published timestamp;
- Notion `last_edited_time`;
- local visibility state;
- content hash;
- created and updated timestamps.

Only published posts are returned by public APIs. Drafts or unpublished Notion pages can remain in D1 for status tracking but stay hidden from the public blog.

### `post_content`

Stores converted article body data:

- post ID;
- Markdown body;
- `block_snapshot_hash`, derived from the normalized Notion block tree;
- rendered content hash;
- resource reference JSON;
- created and updated timestamps.

`block_snapshot_hash` lets sync skip Markdown conversion and resource processing when only Notion metadata changed.

### `assets`

Stores synced external resources:

- source URL fingerprint;
- Notion file metadata when available;
- content hash;
- R2 key;
- MIME type;
- size;
- CDN URL;
- created and last seen timestamps.

R2 keys are content-addressed. A forced refresh can redownload resources, but uploading is skipped when the content hash already exists.

### `sync_runs`

Stores one record per sync execution:

- trigger type: nightly cron or manual;
- requested time range;
- force flag;
- started, finished, and status fields;
- counts for created, updated, metadata-only, skipped, unpublished, archived, and failed items;
- top-level error summary.

### `sync_items`

Stores per-page sync results:

- sync run ID;
- Notion page ID;
- post ID when available;
- action result;
- status;
- error code;
- error message;
- timing and retry metadata.

This gives the admin console enough detail to show which page failed and why.

## Admin Authentication

The admin console uses password-only authentication. On first boot, if no password hash exists, the initial password is `123456`.

Admin auth API:

- `POST /api/admin/login` validates the password and sets an `HttpOnly` session cookie.
- `POST /api/admin/logout` clears the session.
- `GET /api/admin/me` returns the current admin session state.

The admin console includes a password change flow. Passwords are stored as hashes, never as plaintext.

Admin write APIs require a valid session. Mutating requests also use CSRF protection so a browser session cannot be reused silently from another origin.

## Public APIs

- `GET /api/posts` returns paginated published posts and supports tag and keyword filters.
- `GET /api/posts/:slug` returns one published post with metadata and Markdown content.
- `GET /api/tags` returns tags with published post counts.
- `GET /api/search?q=` searches published titles, summaries, tags, and Markdown content.

All public APIs return JSON. Missing content uses structured `404` responses rather than server-rendered error pages.

## Admin APIs

- `GET /api/admin/settings` returns editable settings with sensitive values redacted.
- `PUT /api/admin/settings` saves settings and encrypts sensitive values.
- `POST /api/admin/notion/schema` reads the configured Notion database schema and returns recommended field mappings.
- `POST /api/admin/sync` starts a manual sync with optional time range and force flag.
- `GET /api/admin/sync-runs` lists sync history.
- `GET /api/admin/sync-runs/:id` returns one run and its item-level results.
- `GET /api/admin/posts` lists local post status, Notion IDs, last edited times, and last sync errors.

Errors use a consistent JSON shape:

```json
{
  "error": {
    "code": "FIELD_MAPPING_INVALID",
    "message": "The configured status field does not exist in the Notion database."
  }
}
```

## Field Mapping

The admin console fetches the Notion database schema and recommends field mappings. The user can edit and save the final mapping.

Default recognition rules:

- title: Notion `title` property;
- slug: fields named like `slug`, `url`, or `name`; if absent, generate from title;
- summary: fields named like `summary`, `description`, or `excerpt`;
- tags: fields named like `tags` or `tag`;
- status: fields named like `status`, `publish`, or `published`;
- published date: fields named like `date`, `published_at`, or `published`;
- cover: page cover first, then mapped cover field;
- last edited time: Notion page `last_edited_time`.

The publish rule is explicit: only mapped status values equal to `Published` or `已发布` are public.

## Sync Flow

Nightly sync:

1. Load settings and decrypt required integration values.
2. Determine the last successful sync timestamp.
3. Query Notion for pages whose `last_edited_time` is newer than that timestamp.
4. Sync each page independently.
5. Write item-level results.
6. Mark the run successful, partial, or failed based on item outcomes.

Manual sync:

1. Accept optional start and end times.
2. Accept a force flag.
3. Query Notion for matching pages, or use force mode to bypass local content-change shortcuts.
4. Reuse the same per-page sync pipeline as nightly sync.

Single-page sync:

1. Read Notion page properties.
2. Map properties to local metadata.
3. Save unpublished status locally when the page is not published, but hide it from public APIs.
4. Fetch the page block tree.
5. Normalize blocks and calculate `block_snapshot_hash`.
6. Skip Markdown/resource work when the block hash is unchanged and force mode is off.
7. Convert blocks to Markdown.
8. Download referenced images and files.
9. Calculate resource content hashes and upload missing assets to R2.
10. Replace Notion temporary file URLs with CDN URLs.
11. Calculate Markdown content hash.
12. Upsert `posts`, `post_content`, `assets`, and `sync_items`.

Deletion behavior is conservative. Version one does not physically delete local posts. If a page no longer satisfies the publish rule, it is hidden. If a forced or full refresh detects a page was removed from the database, the local post is marked archived and remains available for admin diagnosis.

## Frontend Pages

Public blog:

- home page with paginated published posts;
- post detail page with Markdown rendering;
- tag archive page;
- search page or search state integrated into the home page.

Admin console:

- login screen;
- overview with integration status, recent sync result, and post counts;
- data source settings with Notion token, database URL, CDN domain, schema test, and field mapping;
- sync management with manual refresh, time range, force flag, sync history, and item failures;
- post status table for local/Notion comparison;
- password change screen.

The admin console does not edit article body content. Notion remains the only content editing surface.

## Error Handling

Sync is resilient at item level. A single failed page does not stop the entire run. The run records a partial status when some pages fail.

Expected error codes:

- `NOTION_AUTH_FAILED`
- `NOTION_DATABASE_NOT_FOUND`
- `FIELD_MAPPING_INVALID`
- `NOTION_RATE_LIMITED`
- `ASSET_DOWNLOAD_FAILED`
- `R2_UPLOAD_FAILED`
- `CONFIG_DECRYPT_FAILED`
- `SYNC_ALREADY_RUNNING`

Notion rate limits use bounded retry with backoff. Asset failures mark the item failed and keep enough context for a forced refresh to retry later.

## Testing Strategy

Tests should cover:

- password hashing and login/session behavior;
- config encryption and decryption;
- Notion database URL parsing;
- Notion schema-to-field-mapping inference;
- publish status detection;
- block tree normalization and Markdown conversion;
- block snapshot hash and Markdown content hash behavior;
- asset hash key generation and CDN URL replacement;
- incremental sync timestamp filtering;
- force refresh behavior;
- public API visibility for published versus unpublished posts;
- admin API authentication and CSRF protection.

## Deployment Requirements

Cloudflare setup needs:

- D1 binding for application data;
- R2 binding for synced assets;
- Cron Trigger for nightly sync;
- `CONFIG_ENCRYPTION_KEY` environment variable;
- Notion Integration Token configured through the admin console;
- Notion database shared with the integration;
- CDN domain configured through the admin console.

The initial admin password is `123456` only when no password hash exists. The admin overview should prompt the user to change it.
