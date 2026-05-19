CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	encrypted INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0, 1)),
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
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

CREATE INDEX IF NOT EXISTS idx_posts_visibility_published_at
	ON posts (visibility, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_notion_last_edited_time
	ON posts (notion_last_edited_time);

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

CREATE TABLE IF NOT EXISTS post_content (
	post_id TEXT PRIMARY KEY,
	markdown TEXT NOT NULL,
	block_snapshot_hash TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	resource_refs_json TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assets (
	id TEXT PRIMARY KEY,
	source_fingerprint TEXT NOT NULL UNIQUE,
	notion_file_json TEXT,
	content_hash TEXT NOT NULL,
	r2_key TEXT NOT NULL UNIQUE,
	mime_type TEXT,
	size INTEGER CHECK (size IS NULL OR size >= 0),
	cdn_url TEXT NOT NULL,
	created_at TEXT NOT NULL,
	last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_content_hash
	ON assets (content_hash);

CREATE TABLE IF NOT EXISTS sync_runs (
	id TEXT PRIMARY KEY,
	trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron', 'manual')),
	started_at TEXT NOT NULL,
	finished_at TEXT,
	status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
	range_start TEXT,
	range_end TEXT,
	force INTEGER NOT NULL DEFAULT 0 CHECK (force IN (0, 1)),
	created_count INTEGER NOT NULL DEFAULT 0 CHECK (created_count >= 0),
	updated_count INTEGER NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
	metadata_only_count INTEGER NOT NULL DEFAULT 0 CHECK (metadata_only_count >= 0),
	skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
	unpublished_count INTEGER NOT NULL DEFAULT 0 CHECK (unpublished_count >= 0),
	archived_count INTEGER NOT NULL DEFAULT 0 CHECK (archived_count >= 0),
	failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
	error_code TEXT,
	error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at
	ON sync_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS sync_items (
	id TEXT PRIMARY KEY,
	sync_run_id TEXT NOT NULL,
	notion_page_id TEXT NOT NULL,
	post_id TEXT,
	action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'metadata_only', 'skipped', 'unpublished', 'archived')),
	status TEXT NOT NULL CHECK (status IN ('success', 'skipped', 'failed')),
	error_code TEXT,
	error_message TEXT,
	started_at TEXT NOT NULL,
	finished_at TEXT,
	FOREIGN KEY (sync_run_id) REFERENCES sync_runs(id) ON DELETE CASCADE,
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_items_run_id
	ON sync_items (sync_run_id);

CREATE INDEX IF NOT EXISTS idx_sync_items_notion_page_id
	ON sync_items (notion_page_id);
