CREATE TABLE IF NOT EXISTS post_sections (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	slug TEXT NOT NULL UNIQUE,
	sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_sections_slug
	ON post_sections (slug);

CREATE INDEX IF NOT EXISTS idx_post_sections_sort
	ON post_sections (sort_order, name);

ALTER TABLE posts
	ADD COLUMN section_id TEXT REFERENCES post_sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_section_visibility
	ON posts (section_id, visibility, manual_visibility, published_at DESC);
