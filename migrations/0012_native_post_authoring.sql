ALTER TABLE posts ADD COLUMN source_type TEXT NOT NULL DEFAULT 'notion' CHECK (source_type IN ('notion', 'local'));
ALTER TABLE posts ADD COLUMN source_id TEXT;

UPDATE posts
SET source_type = 'notion',
	source_id = notion_page_id
WHERE source_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_source
	ON posts (source_type, source_id);

CREATE TABLE IF NOT EXISTS post_drafts (
	id TEXT PRIMARY KEY,
	post_id TEXT,
	title TEXT NOT NULL,
	slug TEXT,
	excerpt TEXT,
	markdown TEXT NOT NULL,
	cover_url TEXT,
	category TEXT,
	tags_json TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
	comments_enabled INTEGER CHECK (comments_enabled IS NULL OR comments_enabled IN (0, 1)),
	published_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_post_drafts_post_id
	ON post_drafts (post_id);

CREATE INDEX IF NOT EXISTS idx_post_drafts_status_updated
	ON post_drafts (status, updated_at DESC);
