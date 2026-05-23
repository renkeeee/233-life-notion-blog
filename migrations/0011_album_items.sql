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

INSERT OR IGNORE INTO album_items (
	id, source_type, source_id, post_id, kind, url, thumbnail_url, large_url,
	r2_key, title, description, caption, taken_at, location_name, latitude,
	longitude, visibility, featured, sort_order, source_content_hash, exif_json,
	created_at, updated_at
)
SELECT
	pm.id,
	'post_media',
	pm.id,
	pm.post_id,
	pm.kind,
	pm.url,
	NULL,
	pm.url,
	pm.r2_key,
	COALESCE(NULLIF(pm.caption, ''), p.title),
	'',
	COALESCE(pm.caption, ''),
	COALESCE(p.published_at, p.updated_at),
	'',
	NULL,
	NULL,
	'visible',
	0,
	pm.sort_order,
	pm.content_hash,
	NULL,
	pm.created_at,
	pm.updated_at
FROM post_media pm
JOIN posts p ON p.id = pm.post_id;
