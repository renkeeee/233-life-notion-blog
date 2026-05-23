# Album Upgrade Design

## Goal

Upgrade Album from a passive aggregation of article media into a manageable album system. Article sync still extracts media into `post_media`, but public Album pages and admin management use a new `album_items` layer so each media item can be edited, hidden, grouped, uploaded manually, and filtered independently.

## Current Behavior

The current `/album` page reads `/api/album`. That API joins `post_media` with public, unlocked posts and returns every synced media resource found inside published article content. The page groups those resources by article publication month and year, then opens an in-page preview for images, videos, audio, PDFs, and files.

This works for automatic discovery, but it has important limits:

- media cannot be managed independently;
- caption comes only from Notion block captions;
- all media inside eligible articles appear in Album;
- visibility follows article state only;
- there is no pagination;
- there are no collections;
- manual uploads are not possible;
- media metadata such as taken date, location, featured state, and EXIF cannot be stored.

## Target Architecture

Keep `post_media` as the sync-derived source table and add a presentation/management layer:

```text
post_media
  -> album_items
  -> album_item_collections
  -> album_collections
```

`post_media` remains a normalized mirror of media discovered during article sync. `album_items` becomes the source for public Album and admin Album APIs.

## Data Model

### `album_items`

- `id`: local item id.
- `source_type`: `post_media` or `manual`.
- `source_id`: source `post_media.id` when auto-created.
- `post_id`: optional source post.
- `kind`: `image`, `video`, `audio`, `pdf`, or `file`.
- `url`: original CDN URL.
- `thumbnail_url`: list thumbnail URL. Images use existing CF Image params.
- `large_url`: preview URL. Images may use a wider CF Image transform or original URL.
- `r2_key`: stored object key when known.
- `title`: editable display title.
- `description`: editable description.
- `caption`: original or edited caption.
- `taken_at`: display date for grouping and sorting.
- `location_name`: editable place label.
- `latitude`, `longitude`: optional location coordinates.
- `visibility`: `visible` or `hidden`.
- `featured`: `0` or `1`.
- `sort_order`: manual ordering fallback.
- `source_content_hash`: source content hash for update detection.
- `exif_json`: parsed EXIF metadata when available.
- `created_at`, `updated_at`: audit timestamps.

### `album_collections`

- `id`, `slug`, `title`, `description`.
- `cover_item_id`: optional cover item.
- `visibility`: `visible` or `hidden`.
- `sort_order`, `created_at`, `updated_at`.

### `album_item_collections`

- `item_id`, `collection_id`, `sort_order`.

## Sync Behavior

When an article sync replaces `post_media`, the sync service also upserts `album_items` for each resulting `post_media` row.

Auto-created items:

- use `post_media.id` as `source_id`;
- use `source_type = post_media`;
- seed `title` from caption or source post title;
- seed `taken_at` from post publication/update time;
- seed `caption`, `kind`, `url`, `r2_key`, and `source_content_hash` from `post_media`.

Existing album items:

- update system fields such as `url`, `kind`, `post_id`, `r2_key`, `source_content_hash`, and derived thumbnail URLs;
- do not overwrite manual fields: `title`, `description`, `caption`, `taken_at`, `location_name`, coordinates, `visibility`, `featured`, and collection membership.

Hidden album items remain hidden after normal or forced article sync.

## Public API

`GET /api/album` reads `album_items`, not `post_media`.

Query parameters:

- `page`: default `1`;
- `limit`: default `30`, capped;
- `year`: UTC year from `taken_at`;
- `month`: UTC month number;
- `kind`: media kind;
- `collection`: collection slug;
- `featured`: `1` for featured only.

Response:

```json
{
  "items": [],
  "page": 1,
  "limit": 30,
  "hasMore": false,
  "collections": []
}
```

Only visible album items are public. Auto-created items whose source post is hidden, archived, manually hidden, or locked are excluded. Manual visible items are public.

`GET /api/album/collections` returns visible collections.

## Public UI

`/album` keeps the current archive-like year/month rhythm, but uses paginated `album_items`.

Add controls:

- All;
- Featured;
- Images;
- Videos;
- collection switcher;
- optional Map view when items contain coordinates.

The item card displays thumbnail, title/caption, media kind, display date, location, and optional source post link. Preview keeps current behavior but prefers `large_url` for image previews.

## Admin API

Add admin endpoints:

- `GET /api/admin/album/items`
- `PATCH /api/admin/album/items/:id`
- `DELETE /api/admin/album/items/:id`
- `POST /api/admin/album/items/:id/restore`
- `POST /api/admin/album/items/upload`
- `POST /api/admin/album/items/batch`
- `GET /api/admin/album/collections`
- `POST /api/admin/album/collections`
- `PATCH /api/admin/album/collections/:id`
- `DELETE /api/admin/album/collections/:id`

All mutating endpoints require admin session and CSRF, following existing admin API patterns.

## Admin UI

Add an `Album` tab to the admin console.

Capabilities:

- paginated media table/grid;
- filter by visibility, source type, kind, collection, featured, and search text;
- edit title, description, caption, date, location, coordinates, featured, visibility, and collections;
- hide/restore/delete;
- batch hide/restore/delete/featured/collection actions;
- create/edit/hide collections;
- upload files to R2 and create manual album items;
- show EXIF metadata when present.

## Upload and EXIF

Manual upload accepts image/video/audio/PDF/file. The Worker uploads the bytes to R2 using the same content-addressed asset key strategy already used for synced assets.

For JPEG images, the Worker extracts basic EXIF when available:

- DateTimeOriginal / DateTime;
- GPS latitude and longitude.

Parsing failures are non-fatal. Extracted metadata seeds `taken_at`, `latitude`, `longitude`, and `exif_json`; admins may override those fields.

## Thumbnail Strategy

Images use existing Cloudflare Image Transform params for list thumbnails:

```text
width=440,quality=82,format=auto
```

To avoid unnecessary transformation variants, Album list thumbnails keep that exact parameter set. `large_url` may use the original CDN URL in the first implementation; a larger transformed preview can be introduced later without changing the model.

## Migration Strategy

Add migration `0011_album_items.sql`:

1. create new tables;
2. backfill `album_items` from existing `post_media` joined to `posts`;
3. preserve all existing public Album media.

`post_media` is not removed.

## Testing Strategy

Add tests for:

- schema and migration contents;
- public Album pagination/filtering and compatibility fields;
- sync upsert from `post_media` into `album_items`;
- manual metadata preservation;
- admin album item edit/hide/restore/delete/batch;
- admin collection CRUD;
- manual upload metadata creation;
- public UI filtering, pagination, collection switch, and preview behavior.
