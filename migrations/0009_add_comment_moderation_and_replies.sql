ALTER TABLE post_comments
	ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'approved' CHECK (moderation_status IN ('pending', 'approved'));

ALTER TABLE post_comments
	ADD COLUMN reply_body TEXT;

ALTER TABLE post_comments
	ADD COLUMN reply_created_at TEXT;

CREATE INDEX IF NOT EXISTS idx_post_comments_status_created_at
	ON post_comments (post_id, moderation_status, created_at);
