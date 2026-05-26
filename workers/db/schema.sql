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
	updated_at TEXT NOT NULL,
	excerpt TEXT NOT NULL DEFAULT '',
	category TEXT,
	manual_visibility TEXT NOT NULL DEFAULT 'visible' CHECK (manual_visibility IN ('visible', 'hidden')),
	locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
	lock_password_encrypted TEXT,
	comments_enabled INTEGER NOT NULL DEFAULT 1 CHECK (comments_enabled IN (0, 1)),
	source_type TEXT NOT NULL DEFAULT 'notion' CHECK (source_type IN ('notion', 'local')),
	source_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_posts_visibility_published_at
	ON posts (visibility, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_notion_last_edited_time
	ON posts (notion_last_edited_time);

CREATE INDEX IF NOT EXISTS idx_posts_category
	ON posts (category);

CREATE INDEX IF NOT EXISTS idx_posts_management_visibility
	ON posts (manual_visibility, locked, visibility, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_source
	ON posts (source_type, source_id);

CREATE TABLE IF NOT EXISTS deleted_posts (
	notion_page_id TEXT PRIMARY KEY,
	post_id TEXT,
	slug TEXT,
	title TEXT,
	deleted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deleted_posts_deleted_at
	ON deleted_posts (deleted_at DESC);

CREATE TABLE IF NOT EXISTS post_comments (
	id TEXT PRIMARY KEY,
	post_id TEXT NOT NULL,
	nickname TEXT NOT NULL,
	body TEXT NOT NULL,
	created_at TEXT NOT NULL,
	moderation_status TEXT NOT NULL DEFAULT 'approved' CHECK (moderation_status IN ('pending', 'approved')),
	reply_body TEXT,
	reply_created_at TEXT,
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_comments_post_created_at
	ON post_comments (post_id, created_at);

CREATE INDEX IF NOT EXISTS idx_post_comments_status_created_at
	ON post_comments (post_id, moderation_status, created_at);

CREATE TABLE IF NOT EXISTS comment_rate_limits (
	key TEXT PRIMARY KEY,
	count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
	reset_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comment_rate_limits_reset_at
	ON comment_rate_limits (reset_at);

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

CREATE TABLE IF NOT EXISTS post_media (
	id TEXT PRIMARY KEY,
	post_id TEXT NOT NULL,
	block_id TEXT,
	kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'pdf', 'file')),
	url TEXT NOT NULL,
	caption TEXT NOT NULL DEFAULT '',
	r2_key TEXT,
	content_hash TEXT,
	sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_post_media_post_id
	ON post_media (post_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_post_media_kind
	ON post_media (kind);

CREATE TABLE IF NOT EXISTS album_items (
	id TEXT PRIMARY KEY,
	source_type TEXT NOT NULL CHECK (source_type IN ('post_media', 'manual')),
	source_id TEXT,
	post_id TEXT,
	kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'pdf', 'file')),
	url TEXT NOT NULL,
	thumbnail_url TEXT,
	large_url TEXT,
	r2_key TEXT,
	title TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	caption TEXT NOT NULL DEFAULT '',
	taken_at TEXT,
	location_name TEXT NOT NULL DEFAULT '',
	latitude REAL CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
	longitude REAL CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
	visibility TEXT NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden')),
	featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
	sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
	source_content_hash TEXT,
	exif_json TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	UNIQUE (source_type, source_id),
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_album_items_visible_taken
	ON album_items (visibility, taken_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_album_items_source
	ON album_items (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_album_items_kind
	ON album_items (kind);

CREATE INDEX IF NOT EXISTS idx_album_items_featured
	ON album_items (featured, visibility, taken_at DESC);

CREATE TABLE IF NOT EXISTS album_collections (
	id TEXT PRIMARY KEY,
	slug TEXT NOT NULL UNIQUE,
	title TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	cover_item_id TEXT,
	visibility TEXT NOT NULL DEFAULT 'visible' CHECK (visibility IN ('visible', 'hidden')),
	sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (cover_item_id) REFERENCES album_items(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_album_collections_visible_order
	ON album_collections (visibility, sort_order, title);

CREATE TABLE IF NOT EXISTS album_item_collections (
	item_id TEXT NOT NULL,
	collection_id TEXT NOT NULL,
	sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
	PRIMARY KEY (item_id, collection_id),
	FOREIGN KEY (item_id) REFERENCES album_items(id) ON DELETE CASCADE,
	FOREIGN KEY (collection_id) REFERENCES album_collections(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_album_item_collections_collection
	ON album_item_collections (collection_id, sort_order, item_id);

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
