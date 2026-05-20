CREATE TABLE IF NOT EXISTS comment_rate_limits (
	key TEXT PRIMARY KEY,
	count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
	reset_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comment_rate_limits_reset_at
	ON comment_rate_limits (reset_at);
