# Simplify Notion Post Fields Design

## Context

The Notion database was simplified. The blog no longer needs separate Notion
columns or local storage for summaries and tags. The local `cover_url` field
remains because page covers should still be cached into R2 and served through
the configured CDN.

## Scope

- Keep `posts.cover_url`.
- Remove `posts.summary` and `posts.tags_json` from the current schema.
- Add a D1 migration that rebuilds `posts` without those two columns.
- Stop inferring or editing Notion mappings for slug, summary, tags, and cover.
- Generate slugs from the title.
- Use only the Notion page-level cover as the source for `cover_url`.
- Stop returning or rendering summary and tag metadata in public APIs and pages.
- Remove the public tag route and `/api/tags`.

## Data Flow

Sync reads title, status, optional published date, page cover, and page blocks
from Notion. Page blocks still convert to Markdown and cache embedded assets.
If the page has a cover, sync downloads it through the same asset cache path and
writes the resulting CDN URL to `posts.cover_url`.

## API And UI

Public post list and detail responses contain `id`, `slug`, `title`,
`coverUrl`, `publishedAt`, `updatedAt`, and Markdown for detail. Public views
show title, date, optional cover, and body content only.

## Testing

Vitest covers the schema migration, simplified repository queries, public API
shape, Notion field inference, settings parsing, sync metadata mapping, cover
asset caching, and the admin schema recommendation endpoint.
