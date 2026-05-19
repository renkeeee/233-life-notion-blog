ALTER TABLE posts
	ADD COLUMN category TEXT;

CREATE INDEX IF NOT EXISTS idx_posts_category
	ON posts (category);
