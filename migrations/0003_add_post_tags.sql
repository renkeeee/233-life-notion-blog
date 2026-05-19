CREATE TABLE IF NOT EXISTS post_tags (
	post_id TEXT NOT NULL,
	tag TEXT NOT NULL,
	sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (post_id, tag),
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_tags_tag
	ON post_tags (tag);

CREATE INDEX IF NOT EXISTS idx_post_tags_post_id
	ON post_tags (post_id, sort_order);
