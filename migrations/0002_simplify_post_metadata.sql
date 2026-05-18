PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_posts_visibility_published_at;
DROP INDEX IF EXISTS idx_posts_notion_last_edited_time;

CREATE TABLE posts_new (
	id TEXT PRIMARY KEY,
	notion_page_id TEXT NOT NULL UNIQUE,
	slug TEXT NOT NULL UNIQUE,
	title TEXT NOT NULL,
	cover_url TEXT,
	status TEXT NOT NULL,
	visibility TEXT NOT NULL CHECK (visibility IN ('published', 'hidden', 'archived')),
	published_at TEXT,
	notion_last_edited_time TEXT NOT NULL,
	content_hash TEXT,
	last_sync_error TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

INSERT INTO posts_new (
	id,
	notion_page_id,
	slug,
	title,
	cover_url,
	status,
	visibility,
	published_at,
	notion_last_edited_time,
	content_hash,
	last_sync_error,
	created_at,
	updated_at
)
SELECT
	id,
	notion_page_id,
	slug,
	title,
	cover_url,
	status,
	visibility,
	published_at,
	notion_last_edited_time,
	content_hash,
	last_sync_error,
	created_at,
	updated_at
FROM posts;

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

CREATE INDEX IF NOT EXISTS idx_posts_visibility_published_at
	ON posts (visibility, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_notion_last_edited_time
	ON posts (notion_last_edited_time);

PRAGMA foreign_key_check;
PRAGMA foreign_keys = ON;
