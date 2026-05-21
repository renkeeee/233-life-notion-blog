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

INSERT OR IGNORE INTO post_media (
	id, post_id, block_id, kind, url, caption, r2_key,
	content_hash, sort_order, created_at, updated_at
)
SELECT
	pc.post_id || ':' ||
	COALESCE(
		NULLIF(json_extract(resource.value, '$.blockId'), ''),
		NULLIF(json_extract(resource.value, '$.contentHash'), ''),
		'resource'
	) || ':' || resource.key,
	pc.post_id,
	json_extract(resource.value, '$.blockId'),
	json_extract(resource.value, '$.blockType'),
	COALESCE(
		NULLIF(json_extract(resource.value, '$.cdnUrl'), ''),
		NULLIF(json_extract(resource.value, '$.sourceUrl'), '')
	),
	COALESCE(json_extract(resource.value, '$.caption'), ''),
	json_extract(resource.value, '$.r2Key'),
	json_extract(resource.value, '$.contentHash'),
	CAST(resource.key AS INTEGER),
	pc.created_at,
	pc.updated_at
FROM post_content pc, json_each(pc.resource_refs_json) AS resource
WHERE json_valid(pc.resource_refs_json)
	AND json_extract(resource.value, '$.blockType') IN ('image', 'video', 'audio', 'pdf', 'file')
	AND COALESCE(
		NULLIF(json_extract(resource.value, '$.cdnUrl'), ''),
		NULLIF(json_extract(resource.value, '$.sourceUrl'), '')
	) IS NOT NULL;
