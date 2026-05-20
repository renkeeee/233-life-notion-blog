ALTER TABLE posts
	ADD COLUMN manual_visibility TEXT NOT NULL DEFAULT 'visible' CHECK (manual_visibility IN ('visible', 'hidden'));

ALTER TABLE posts
	ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1));

ALTER TABLE posts
	ADD COLUMN lock_password_encrypted TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_management_visibility
	ON posts (manual_visibility, locked, visibility, published_at DESC);

CREATE TABLE IF NOT EXISTS deleted_posts (
	notion_page_id TEXT PRIMARY KEY,
	post_id TEXT,
	slug TEXT,
	title TEXT,
	deleted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deleted_posts_deleted_at
	ON deleted_posts (deleted_at DESC);
