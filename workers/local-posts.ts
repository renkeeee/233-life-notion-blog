import type { AppEnv } from "./types";
import {
	buildAssetKey,
	cdnUrlForKey,
	contentHashForBytes,
	uploadAssetIfMissing,
} from "./assets";
import { loadCommentsDefaultEnabled } from "./comments";
import { sha256Hex } from "./crypto";
import { SettingsRepository } from "./db/d1";

export type LocalDraftStatus = "draft" | "published" | "archived";

export interface LocalDraftInput {
	title: unknown;
	slug?: unknown;
	excerpt?: unknown;
	markdown?: unknown;
	coverUrl?: unknown;
	category?: unknown;
	tags?: unknown;
	commentsEnabled?: unknown;
	publishedAt?: unknown;
}

export interface ValidLocalDraftInput {
	title: string;
	slug: string | null;
	excerpt: string;
	markdown: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	commentsEnabled: boolean | null;
	publishedAt: string | null;
}

export interface LocalDraftRecord {
	id: string;
	postId: string | null;
	title: string;
	slug: string | null;
	excerpt: string;
	markdown: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	status: LocalDraftStatus;
	commentsEnabled: boolean | null;
	publishedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface ValidLocalImageUpload {
	contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
	size: number;
}

export interface LocalImageUploadResult {
	url: string;
	r2Key: string;
	contentHash: string;
	contentType: ValidLocalImageUpload["contentType"];
	size: number;
}

type LocalDraftRow = {
	id: string;
	post_id: string | null;
	title: string;
	slug: string | null;
	excerpt: string | null;
	markdown: string;
	cover_url: string | null;
	category: string | null;
	tags_json: string;
	status: LocalDraftStatus;
	comments_enabled: number | null;
	published_at: string | null;
	created_at: string;
	updated_at: string;
};

type PublishedPostForDraftRow = {
	id: string;
	source_type: "notion" | "local" | null;
	title: string;
	slug: string;
	excerpt: string | null;
	markdown: string | null;
	cover_url: string | null;
	category: string | null;
	comments_enabled: number | boolean;
	published_at: string | null;
};

export type LocalDraftFromPostResult =
	| { draft: LocalDraftRecord }
	| { error: "NOT_FOUND" | "NOT_LOCAL" };

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugValidationMessage =
	"Slug must contain only lowercase letters, numbers, and hyphens";
const maxLocalImageUploadBytes = 10 * 1024 * 1024;
const localImageContentTypes = new Map<
	string,
	ValidLocalImageUpload["contentType"]
>([
	["image/jpeg", "image/jpeg"],
	["image/jpg", "image/jpeg"],
	["image/png", "image/png"],
	["image/webp", "image/webp"],
	["image/gif", "image/gif"],
]);

export function normalizeLocalPostSlug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");
}

export function validateLocalDraftInput(
	input: LocalDraftInput,
): ValidLocalDraftInput {
	const title = requiredString(input.title, "Title");
	const slug = optionalSlug(input.slug);

	if (slug !== null && !slugPattern.test(slug)) {
		throw new Error(slugValidationMessage);
	}

	return {
		title,
		slug,
		excerpt: optionalDefaultString(input.excerpt, "Excerpt"),
		markdown: optionalMarkdown(input.markdown),
		coverUrl: optionalNullableString(input.coverUrl, "Cover URL"),
		category: optionalNullableString(input.category, "Category"),
		tags: normalizeTags(input.tags),
		commentsEnabled: optionalBoolean(input.commentsEnabled, "Comments enabled"),
		publishedAt: optionalNullableString(input.publishedAt, "Published date"),
	};
}

export function validateLocalPublishInput(
	input: LocalDraftInput,
): ValidLocalDraftInput {
	const draft = validateLocalDraftInput(input);

	if (draft.slug === null) {
		throw new Error("Slug is required");
	}

	if (draft.markdown.trim().length === 0) {
		throw new Error("Markdown is required");
	}

	return draft;
}

export function parseTagsJson(value: string): string[] {
	try {
		const parsed = JSON.parse(value) as unknown;

		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.filter((tag): tag is string => typeof tag === "string");
	} catch {
		return [];
	}
}

export function validateLocalImageUpload(
	contentType: string | null,
	byteLength: number,
): ValidLocalImageUpload {
	if (byteLength > maxLocalImageUploadBytes) {
		throw new Error("Image must be at most 10MB");
	}

	const normalizedContentType =
		contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
	const validContentType = localImageContentTypes.get(normalizedContentType);

	if (!validContentType) {
		throw new Error("Unsupported image type");
	}

	return {
		contentType: validContentType,
		size: byteLength,
	};
}

async function cdnBaseUrlForLocalUpload(env: AppEnv): Promise<string> {
	const row = await new SettingsRepository(env.DB).get("cdnBaseUrl");

	return row?.value ?? "https://assets.233.life";
}

export async function uploadLocalPostImage(
	env: AppEnv,
	request: Request,
	now = new Date().toISOString(),
): Promise<LocalImageUploadResult> {
	const bytes = await request.arrayBuffer();
	const upload = validateLocalImageUpload(
		request.headers.get("content-type"),
		bytes.byteLength,
	);
	const contentHash = await contentHashForBytes(bytes);
	const r2Key = buildAssetKey(contentHash, upload.contentType);
	const url = cdnUrlForKey(await cdnBaseUrlForLocalUpload(env), r2Key);

	try {
		await uploadAssetIfMissing(env.BLOG_ASSETS, r2Key, bytes, {
			contentType: upload.contentType,
			cacheControl: "public, max-age=31536000, immutable",
		});
	} catch {
		throw new Error("R2_UPLOAD_FAILED");
	}

	await env.DB.prepare(
		`INSERT INTO assets (
			id, source_fingerprint, notion_file_json, content_hash, r2_key,
			mime_type, size, cdn_url, created_at, last_seen_at
		)
		VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(source_fingerprint) DO UPDATE SET
			content_hash = excluded.content_hash,
			r2_key = excluded.r2_key,
			mime_type = excluded.mime_type,
			size = excluded.size,
			cdn_url = excluded.cdn_url,
			last_seen_at = excluded.last_seen_at
		ON CONFLICT(r2_key) DO UPDATE SET
			content_hash = excluded.content_hash,
			mime_type = excluded.mime_type,
			size = excluded.size,
			cdn_url = excluded.cdn_url,
			last_seen_at = excluded.last_seen_at`,
	)
		.bind(
			`local-upload:${contentHash}`,
			`local-upload:${contentHash}`,
			contentHash,
			r2Key,
			upload.contentType,
			upload.size,
			url,
			now,
			now,
		)
		.run();

	return {
		url,
		r2Key,
		contentHash,
		contentType: upload.contentType,
		size: upload.size,
	};
}

function mapDraftRow(row: LocalDraftRow): LocalDraftRecord {
	return {
		id: row.id,
		postId: row.post_id,
		title: row.title,
		slug: row.slug,
		excerpt: row.excerpt ?? "",
		markdown: row.markdown,
		coverUrl: row.cover_url,
		category: row.category,
		tags: parseTagsJson(row.tags_json),
		status: row.status,
		commentsEnabled:
			row.comments_enabled === null ? null : row.comments_enabled === 1,
		publishedAt: row.published_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function createLocalDraft(
	env: AppEnv,
	input: LocalDraftInput,
	now = new Date().toISOString(),
): Promise<LocalDraftRecord> {
	const draft = validateLocalDraftInput(input);
	const id = crypto.randomUUID();

	await env.DB.prepare(
		`INSERT INTO post_drafts (
			id, post_id, title, slug, excerpt, markdown, cover_url, category,
			tags_json, status, comments_enabled, published_at, created_at, updated_at
		)
		VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
	)
		.bind(
			id,
			draft.title,
			draft.slug,
			draft.excerpt,
			draft.markdown,
			draft.coverUrl,
			draft.category,
			JSON.stringify(draft.tags),
			draft.commentsEnabled === null ? null : draft.commentsEnabled ? 1 : 0,
			draft.publishedAt,
			now,
			now,
		)
		.run();

	const created = await getLocalDraft(env, id);
	if (!created) {
		throw new Error("Local draft could not be loaded");
	}

	return created;
}

export async function createLocalDraftFromPublishedPost(
	env: AppEnv,
	postId: string,
	now = new Date().toISOString(),
): Promise<LocalDraftFromPostResult> {
	const post = await env.DB.prepare(
		`SELECT
			p.id,
			p.source_type,
			p.title,
			p.slug,
			p.excerpt,
			pc.markdown,
			p.cover_url,
			p.category,
			p.comments_enabled,
			p.published_at
		 FROM posts p
		 LEFT JOIN post_content pc ON pc.post_id = p.id
		 WHERE p.id = ?
		 LIMIT 1`,
	)
		.bind(postId)
		.first<PublishedPostForDraftRow>();

	if (!post) {
		return { error: "NOT_FOUND" };
	}

	if ((post.source_type ?? "notion") !== "local") {
		return { error: "NOT_LOCAL" };
	}

	const existingDraft = await env.DB.prepare(
		`SELECT
			id, post_id, title, slug, excerpt, markdown, cover_url, category,
			tags_json, status, comments_enabled, published_at, created_at, updated_at
		 FROM post_drafts
		 WHERE post_id = ?
		 LIMIT 1`,
	)
		.bind(postId)
		.first<LocalDraftRow>();

	if (existingDraft) {
		return { draft: mapDraftRow(existingDraft) };
	}

	const tags = await tagsForPost(env, postId);
	const draftId = crypto.randomUUID();
	await env.DB.prepare(
		`INSERT INTO post_drafts (
			id, post_id, title, slug, excerpt, markdown, cover_url, category,
			tags_json, status, comments_enabled, published_at, created_at, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
	)
		.bind(
			draftId,
			post.id,
			post.title,
			post.slug,
			post.excerpt ?? "",
			post.markdown ?? "",
			post.cover_url,
			post.category,
			JSON.stringify(tags),
			post.comments_enabled === 1 || post.comments_enabled === true ? 1 : 0,
			post.published_at,
			now,
			now,
		)
		.run();

	const draft = await getLocalDraft(env, draftId);
	if (!draft) {
		throw new Error("Local draft could not be loaded");
	}

	return { draft };
}

export async function getLocalDraft(
	env: AppEnv,
	id: string,
): Promise<LocalDraftRecord | null> {
	const row = await env.DB.prepare(
		`SELECT
			id, post_id, title, slug, excerpt, markdown, cover_url, category,
			tags_json, status, comments_enabled, published_at, created_at, updated_at
		 FROM post_drafts
		 WHERE id = ?`,
	)
		.bind(id)
		.first<LocalDraftRow>();

	return row ? mapDraftRow(row) : null;
}

export async function listLocalDrafts(
	env: AppEnv,
): Promise<LocalDraftRecord[]> {
	const result = await env.DB.prepare(
		`SELECT
			id, post_id, title, slug, excerpt, markdown, cover_url, category,
			tags_json, status, comments_enabled, published_at, created_at, updated_at
		 FROM post_drafts
		 WHERE status = 'draft'
		 ORDER BY updated_at DESC`,
	).all<LocalDraftRow>();

	return result.results.map(mapDraftRow);
}

export async function deleteLocalDraft(
	env: AppEnv,
	id: string,
): Promise<boolean> {
	const existing = await getLocalDraft(env, id);
	if (!existing || existing.status !== "draft") {
		return false;
	}

	await env.DB.prepare("DELETE FROM post_drafts WHERE id = ?")
		.bind(id)
		.run();

	return true;
}

async function tagsForPost(env: AppEnv, postId: string): Promise<string[]> {
	const result = await env.DB.prepare(
		`SELECT tag
		 FROM post_tags
		 WHERE post_id = ?
		 ORDER BY sort_order ASC, tag ASC`,
	)
		.bind(postId)
		.all<{ tag: string }>();

	return result.results
		.map((row) => row.tag)
		.filter((tag): tag is string => typeof tag === "string");
}

export async function updateLocalDraft(
	env: AppEnv,
	id: string,
	input: LocalDraftInput,
	now = new Date().toISOString(),
): Promise<LocalDraftRecord | null> {
	const draft = validateLocalDraftInput(input);
	const existing = await getLocalDraft(env, id);

	if (!existing) {
		return null;
	}

	await env.DB.prepare(
		`UPDATE post_drafts
		 SET title = ?,
			 slug = ?,
			 excerpt = ?,
			 markdown = ?,
			 cover_url = ?,
			 category = ?,
			 tags_json = ?,
			 comments_enabled = ?,
			 published_at = ?,
			 updated_at = ?
		 WHERE id = ?`,
	)
		.bind(
			draft.title,
			draft.slug,
			draft.excerpt,
			draft.markdown,
			draft.coverUrl,
			draft.category,
			JSON.stringify(draft.tags),
			draft.commentsEnabled === null ? null : draft.commentsEnabled ? 1 : 0,
			draft.publishedAt,
			now,
			id,
		)
		.run();

	return getLocalDraft(env, id);
}

export function contentHashForMarkdown(markdown: string): Promise<string> {
	return sha256Hex(markdown);
}

export async function ensureUniqueSlug(
	env: AppEnv,
	slug: string,
	postId: string,
): Promise<void> {
	const existing = await env.DB.prepare(
		`SELECT id
		 FROM posts
		 WHERE slug = ?
		 AND id <> ?
		 LIMIT 1`,
	)
		.bind(slug, postId)
		.first<{ id: string }>();

	if (existing) {
		throw new Error("Slug already exists");
	}
}

async function runStatements(
	db: D1Database,
	statements: D1PreparedStatement[],
): Promise<void> {
	const batch = (db as { batch?: D1Database["batch"] }).batch;

	if (typeof batch === "function") {
		await batch.call(db, statements);
		return;
	}

	for (const statement of statements) {
		await statement.run();
	}
}

export function prepareReplacePostTags(
	env: AppEnv,
	postId: string,
	tags: string[],
	now = new Date().toISOString(),
): D1PreparedStatement[] {
	const statements = [
		env.DB.prepare("DELETE FROM post_tags WHERE post_id = ?").bind(postId),
	];

	for (const [index, tag] of tags.entries()) {
		statements.push(
			env.DB.prepare(
				`INSERT INTO post_tags (
					post_id, tag, sort_order, created_at, updated_at
				)
				VALUES (?, ?, ?, ?, ?)`,
			)
				.bind(postId, tag, index, now, now),
		);
	}

	return statements;
}

export async function replacePostTags(
	env: AppEnv,
	postId: string,
	tags: string[],
	now = new Date().toISOString(),
): Promise<void> {
	await runStatements(env.DB, prepareReplacePostTags(env, postId, tags, now));
}

type LocalPostMediaRecord = {
	id: string;
	url: string;
	contentHash: string;
	sortOrder: number;
};

type ExistingLocalPostIdentity = {
	notion_page_id: string;
	source_type: "notion" | "local" | null;
	source_id: string | null;
};

export function thumbnailUrlForImage(url: string): string | null {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}/cdn-cgi/image/width=440,quality=82,format=auto${parsed.pathname}${parsed.search}`;
	} catch {
		return null;
	}
}

async function localPostMediaRecords(
	postId: string,
	markdown: string,
): Promise<LocalPostMediaRecord[]> {
	const urls = extractMarkdownImageUrls(markdown);
	const occurrences = new Map<string, number>();
	const records: LocalPostMediaRecord[] = [];

	for (const [index, url] of urls.entries()) {
		const occurrence = occurrences.get(url) ?? 0;
		occurrences.set(url, occurrence + 1);
		records.push({
			id: `local-media:${await sha256Hex(`${postId}:${url}:${occurrence}`)}`,
			url,
			contentHash: await sha256Hex(url),
			sortOrder: index,
		});
	}

	return records;
}

function prepareHideMissingLocalAlbumItems(
	env: AppEnv,
	postId: string,
	mediaRecords: LocalPostMediaRecord[],
	now: string,
): D1PreparedStatement {
	if (mediaRecords.length === 0) {
		return env.DB.prepare(
			`UPDATE album_items
			 SET visibility = 'hidden',
				 updated_at = ?
			 WHERE post_id = ?
			 AND source_type = 'post_media'`,
		).bind(now, postId);
	}

	const placeholders = mediaRecords.map(() => "?").join(", ");
	return env.DB.prepare(
		`UPDATE album_items
		 SET visibility = 'hidden',
			 updated_at = ?
		 WHERE post_id = ?
		 AND source_type = 'post_media'
		 AND source_id NOT IN (${placeholders})`,
	).bind(now, postId, ...mediaRecords.map((media) => media.id));
}

function prepareReplaceLocalPostMedia(
	env: AppEnv,
	postId: string,
	postTitle: string,
	publishedAt: string,
	mediaRecords: LocalPostMediaRecord[],
	now: string,
): D1PreparedStatement[] {
	const statements: D1PreparedStatement[] = [
		prepareHideMissingLocalAlbumItems(env, postId, mediaRecords, now),
		env.DB.prepare("DELETE FROM post_media WHERE post_id = ?").bind(postId),
	];

	for (const media of mediaRecords) {
		statements.push(
			env.DB.prepare(
				`INSERT INTO post_media (
					id, post_id, block_id, kind, url, caption, r2_key,
					content_hash, sort_order, created_at, updated_at
				)
				VALUES (?, ?, NULL, 'image', ?, '', NULL, ?, ?, ?, ?)`,
			)
				.bind(
					media.id,
					postId,
					media.url,
					media.contentHash,
					media.sortOrder,
					now,
					now,
				),
		);

		statements.push(
			env.DB.prepare(
				`INSERT INTO album_items (
					id, source_type, source_id, post_id, kind, url, thumbnail_url,
					large_url, r2_key, title, description, caption, taken_at,
					location_name, latitude, longitude, visibility, featured,
					sort_order, source_content_hash, exif_json, created_at, updated_at
				)
				VALUES (?, 'post_media', ?, ?, 'image', ?, ?, ?, NULL, ?, '', '', ?,
					'', NULL, NULL, 'visible', 0, ?, ?, NULL, ?, ?)
				ON CONFLICT(source_type, source_id) DO UPDATE SET
					post_id = excluded.post_id,
					kind = excluded.kind,
					url = excluded.url,
					thumbnail_url = excluded.thumbnail_url,
					large_url = excluded.large_url,
					r2_key = excluded.r2_key,
					sort_order = excluded.sort_order,
					source_content_hash = excluded.source_content_hash,
					updated_at = excluded.updated_at`,
			)
				.bind(
					media.id,
					media.id,
					postId,
					media.url,
					thumbnailUrlForImage(media.url),
					media.url,
					postTitle,
					publishedAt,
					media.sortOrder,
					media.contentHash,
					now,
					now,
				),
		);
	}

	return statements;
}

export async function publishLocalDraft(
	env: AppEnv,
	draftId: string,
	now = new Date().toISOString(),
): Promise<LocalDraftRecord | null> {
	const draft = await getLocalDraft(env, draftId);

	if (!draft) {
		return null;
	}

	const input = validateLocalPublishInput(draft);
	const postId = draft.postId ?? crypto.randomUUID();
	const existingIdentity = draft.postId
		? await env.DB.prepare(
				`SELECT notion_page_id, source_type, source_id
				 FROM posts
				 WHERE id = ?
				 LIMIT 1`,
			)
				.bind(draft.postId)
				.first<ExistingLocalPostIdentity>()
		: null;

	if (
		existingIdentity &&
		(existingIdentity.source_type ?? "notion") !== "local"
	) {
		throw new Error("Only local posts can be published here");
	}

	const sourceId = existingIdentity ? existingIdentity.source_id : draft.id;
	const notionPageId = existingIdentity
		? existingIdentity.notion_page_id
		: `local:${sourceId}`;
	const slug = input.slug;
	if (slug === null) {
		throw new Error("Slug is required");
	}
	const contentHash = await contentHashForMarkdown(input.markdown);
	const publishedAt = input.publishedAt ?? draft.publishedAt ?? now;
	const commentsEnabled =
		input.commentsEnabled ?? (await loadCommentsDefaultEnabled(env.DB));
	const mediaRecords = await localPostMediaRecords(postId, input.markdown);

	await ensureUniqueSlug(env, slug, postId);

	const statements: D1PreparedStatement[] = [
		env.DB.prepare(
			`INSERT INTO posts (
				id, notion_page_id, slug, title, excerpt, cover_url, category,
				status, visibility, published_at, notion_last_edited_time,
				content_hash, last_sync_error, created_at, updated_at, comments_enabled,
				source_type, source_id
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, 'published', 'published', ?, ?, ?, NULL, ?, ?, ?, 'local', ?)
			ON CONFLICT(id) DO UPDATE SET
				notion_page_id = excluded.notion_page_id,
				slug = excluded.slug,
				title = excluded.title,
				excerpt = excluded.excerpt,
				cover_url = excluded.cover_url,
				category = excluded.category,
				status = excluded.status,
				visibility = excluded.visibility,
				published_at = excluded.published_at,
				notion_last_edited_time = excluded.notion_last_edited_time,
				content_hash = excluded.content_hash,
				last_sync_error = NULL,
				updated_at = excluded.updated_at,
				comments_enabled = excluded.comments_enabled,
				source_type = excluded.source_type,
				source_id = excluded.source_id`,
		)
			.bind(
				postId,
				notionPageId,
				slug,
				input.title,
				input.excerpt,
				input.coverUrl,
				input.category,
				publishedAt,
				now,
				contentHash,
				now,
				now,
				commentsEnabled ? 1 : 0,
				sourceId,
			),
		env.DB.prepare(
			`INSERT INTO post_content (
				post_id, markdown, block_snapshot_hash, content_hash,
				resource_refs_json, created_at, updated_at
			)
			VALUES (?, ?, ?, ?, '[]', ?, ?)
			ON CONFLICT(post_id) DO UPDATE SET
				markdown = excluded.markdown,
				block_snapshot_hash = excluded.block_snapshot_hash,
				content_hash = excluded.content_hash,
				resource_refs_json = excluded.resource_refs_json,
				updated_at = excluded.updated_at`,
		)
			.bind(
				postId,
				input.markdown,
				`local:${contentHash}`,
				contentHash,
				now,
				now,
			),
		...prepareReplacePostTags(env, postId, input.tags, now),
		...prepareReplaceLocalPostMedia(
			env,
			postId,
			input.title,
			publishedAt,
			mediaRecords,
			now,
		),
		env.DB.prepare(
			`UPDATE post_drafts
			 SET post_id = ?,
				 status = 'published',
				 published_at = ?,
				 updated_at = ?
			 WHERE id = ?`,
		)
			.bind(postId, publishedAt, now, draftId),
	];

	await runStatements(env.DB, statements);

	return getLocalDraft(env, draftId);
}

export async function unpublishLocalDraft(
	env: AppEnv,
	draftId: string,
	now = new Date().toISOString(),
): Promise<LocalDraftRecord | null> {
	const draft = await getLocalDraft(env, draftId);

	if (!draft) {
		return null;
	}

	if (!draft.postId) {
		return draft;
	}

	await env.DB.prepare(
		`UPDATE posts
		 SET visibility = 'archived',
			 updated_at = ?
		 WHERE id = ?
		 AND source_type = 'local'`,
	)
		.bind(now, draft.postId)
		.run();

	await env.DB.prepare(
		`UPDATE post_drafts
		 SET status = 'draft',
			 updated_at = ?
		 WHERE id = ?`,
	)
		.bind(now, draftId)
		.run();

	return getLocalDraft(env, draftId);
}

export function localDraftResponse(draft: LocalDraftRecord) {
	return {
		id: draft.id,
		postId: draft.postId,
		title: draft.title,
		slug: draft.slug,
		excerpt: draft.excerpt,
		markdown: draft.markdown,
		coverUrl: draft.coverUrl,
		category: draft.category,
		tags: draft.tags,
		status: draft.status,
		commentsEnabled: draft.commentsEnabled,
		publishedAt: draft.publishedAt,
		createdAt: draft.createdAt,
		updatedAt: draft.updatedAt,
	};
}

export function extractMarkdownImageUrls(markdown: string): string[] {
	const urls: string[] = [];
	const imagePattern = /!\[[^\]\n]*(?:\][^\[\]\n]*)*]\(([^)]*)\)/g;
	let match: RegExpExecArray | null;

	while ((match = imagePattern.exec(markdown)) !== null) {
		const destination = parseMarkdownLinkDestination(match[1]);

		if (destination !== null) {
			urls.push(destination);
		}
	}

	return urls;
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} is required`);
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${label} is required`);
	}

	return trimmed;
}

function optionalNullableString(
	value: unknown,
	label: string,
): string | null {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value !== "string") {
		throw new Error(`${label} must be a string`);
	}

	const trimmed = value.trim();
	return trimmed.length === 0 ? null : trimmed;
}

function optionalSlug(value: unknown): string | null {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value !== "string") {
		throw new Error("Slug must be a string");
	}

	return value.trim().length === 0 ? null : value;
}

function optionalDefaultString(value: unknown, label: string): string {
	if (value === undefined || value === null) {
		return "";
	}

	if (typeof value !== "string") {
		throw new Error(`${label} must be a string`);
	}

	return value.trim();
}

function optionalMarkdown(value: unknown): string {
	if (value === undefined || value === null) {
		return "";
	}

	if (typeof value !== "string") {
		throw new Error("Markdown must be a string");
	}

	return value;
}

function optionalBoolean(value: unknown, label: string): boolean | null {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value !== "boolean") {
		throw new Error(`${label} must be a boolean`);
	}

	return value;
}

function normalizeTags(value: unknown): string[] {
	if (value === undefined || value === null) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new Error("Tags must be an array");
	}

	const tags: string[] = [];
	const seen = new Set<string>();

	for (const tag of value) {
		if (typeof tag !== "string") {
			throw new Error("Tags must contain only strings");
		}

		const trimmed = tag.trim();
		if (trimmed.length === 0 || seen.has(trimmed)) {
			continue;
		}

		seen.add(trimmed);
		tags.push(trimmed);
	}

	return tags;
}

function parseMarkdownLinkDestination(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}

	if (trimmed.startsWith("<")) {
		const closingIndex = trimmed.indexOf(">");
		return closingIndex > 1 ? trimmed.slice(1, closingIndex) : null;
	}

	const destination = trimmed.split(/\s+/, 1)[0];
	return destination.length > 0 ? destination : null;
}
