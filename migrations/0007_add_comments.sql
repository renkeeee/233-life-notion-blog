ALTER TABLE posts
	ADD COLUMN comments_enabled INTEGER NOT NULL DEFAULT 1 CHECK (comments_enabled IN (0, 1));

CREATE TABLE IF NOT EXISTS post_comments (
	id TEXT PRIMARY KEY,
	post_id TEXT NOT NULL,
	nickname TEXT NOT NULL,
	body TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post_created_at
	ON post_comments (post_id, created_at);
