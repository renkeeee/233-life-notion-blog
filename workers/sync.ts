import {
	buildAssetKey,
	cdnUrlForKey,
	contentHashForBytes,
	uploadAssetIfMissing,
} from "./assets";
import { loadCommentsDefaultEnabled } from "./comments";
import { sha256Hex } from "./crypto";
import { SettingsRepository } from "./db/d1";
import { NotionApiError, NotionClient, type NotionFetcher } from "./notion/client";
import {
	blocksToMarkdown,
	extractBlockAssetRefs,
	normalizedBlocksHash,
	type BlockAssetRef,
	type NotionBlock,
} from "./notion/blocks";
import { isPublishedStatus } from "./notion/database";
import { parseSettingsFromRows } from "./settings";
import {
	DEFAULT_PUBLISHED_STATUS_VALUES,
	type ApiErrorCode,
	type AppEnv,
	type FieldMapping,
	type PublicAlbumMediaKind,
	type PostVisibility,
	type SiteSettings,
} from "./types";

export interface RunSyncInput {
	triggerType: "cron" | "manual";
	rangeStart?: string | null;
	rangeEnd?: string | null;
	force?: boolean;
	notionPageId?: string;
}

export interface SyncWindowInput {
	lastSuccessfulSync?: string | null;
	rangeStart?: string | null;
	rangeEnd?: string | null;
	force?: boolean;
}

export interface SyncWindow {
	start: string | null;
	end: string | null;
}

export interface NotionSyncPage {
	id: string;
	created_time?: string;
	last_edited_time?: string;
	archived?: boolean;
	in_trash?: boolean;
	properties?: Record<string, unknown>;
	cover?: unknown;
	[key: string]: unknown;
}

export interface NotionSyncSource {
	listPages(
		settings: SiteSettings,
		window: SyncWindow,
	): Promise<NotionSyncPage[]>;
	retrievePage?(
		settings: SiteSettings,
		pageId: string,
	): Promise<NotionSyncPage>;
	listBlocks(settings: SiteSettings, pageId: string): Promise<NotionBlock[]>;
}

export interface SyncDependencies {
	now?: () => string;
	id?: () => string;
	fetcher?: NotionFetcher;
	notionSource?: NotionSyncSource;
}

export interface PostMetadata {
	id: string;
	notionPageId: string;
	slug: string;
	title: string;
	excerpt: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	status: string;
	visibility: PostVisibility;
	publishedAt: string | null;
	notionLastEditedTime: string;
}

type SyncAction =
	| "created"
	| "updated"
	| "metadata_only"
	| "skipped"
	| "unpublished"
	| "archived"
	| "failed";

type SyncItemAction = Exclude<SyncAction, "failed">;

type SyncCounts = Record<SyncAction, number>;

interface ResolvedSyncDependencies {
	now: () => string;
	id: () => string;
	fetcher: NotionFetcher;
	notionSource: NotionSyncSource;
}

interface ExistingPostState {
	id: string;
	notion_last_edited_time: string;
	content_hash: string | null;
	slug: string;
	title: string;
	excerpt: string;
	cover_url: string | null;
	category: string | null;
	status: string;
	visibility: PostVisibility;
	published_at: string | null;
}

interface ExistingContentState {
	block_snapshot_hash: string;
	content_hash: string;
	markdown: string;
}

interface DeletedPostState {
	notion_page_id: string;
	post_id: string | null;
	slug: string | null;
	title: string | null;
	deleted_at: string;
}

interface CachedAsset {
	sourceUrl: string;
	cdnUrl: string;
	r2Key: string;
	contentHash: string;
	mimeType: string | null;
	size: number;
}

interface ResourceRefRecord extends BlockAssetRef {
	sourceUrl: string;
	cdnUrl: string;
	r2Key: string;
	contentHash: string;
}

class SyncError extends Error {
	constructor(
		readonly code: ApiErrorCode,
		message: string,
		readonly cause?: unknown,
	) {
		super(message);
		this.name = "SyncError";
	}
}

const defaultFetcher: NotionFetcher = (input, init) => fetch(input, init);

export function planSyncWindow(input: SyncWindowInput): SyncWindow {
	return {
		start: input.rangeStart ?? (input.force ? null : (input.lastSuccessfulSync ?? null)),
		end: input.rangeEnd ?? null,
	};
}

export function syncVisibilityForStatus(
	status: unknown,
	publishedStatusValues: readonly string[] = DEFAULT_PUBLISHED_STATUS_VALUES,
): "published" | "hidden" {
	return isPublishedStatus(status, publishedStatusValues) ? "published" : "hidden";
}

export function excerptFromMarkdown(markdown: string, maxLength = 180): string {
	const plainText = markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[[^\]]*]\([^)]*\)/g, " ")
		.replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/^>\s?/gm, "")
		.replace(/[`*_~]/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (plainText.length <= maxLength) {
		return plainText;
	}

	const clipped = plainText.slice(0, maxLength).trimEnd();
	const lastSpace = clipped.lastIndexOf(" ");
	const wordSafe =
		lastSpace >= Math.floor(maxLength * 0.6)
			? clipped.slice(0, lastSpace).trimEnd()
			: clipped;

	return `${wordSafe}...`;
}

export function mapNotionPageToPostMetadata(
	page: NotionSyncPage,
	mapping: FieldMapping,
	now = new Date().toISOString(),
): PostMetadata {
	const properties = page.properties ?? {};
	const status = propertyValue(properties[mapping.status]) ?? "";
	const title = stringProperty(properties[mapping.title]) || "Untitled";
	const slug = slugify(title) || page.id;
	const archived = page.archived === true || page.in_trash === true;
	const createdTime = typeof page.created_time === "string" ? page.created_time : null;

	return {
		id: page.id,
		notionPageId: page.id,
		slug,
		title,
		excerpt: "",
		coverUrl: pageCoverUrl(page),
		category: mapping.category
			? categoryProperty(properties[mapping.category])
			: null,
		tags: mapping.tags ? tagProperty(properties[mapping.tags]) : [],
		status: String(status),
		visibility: archived
			? "archived"
			: syncVisibilityForStatus(
					status,
					mapping.publishedStatusValues ?? DEFAULT_PUBLISHED_STATUS_VALUES,
				),
		publishedAt: mapping.publishedAt
			? (dateProperty(properties[mapping.publishedAt]) ?? createdTime)
			: createdTime,
		notionLastEditedTime:
			typeof page.last_edited_time === "string" ? page.last_edited_time : now,
	};
}

export async function runSync(
	env: AppEnv,
	input: RunSyncInput,
	dependencies: SyncDependencies = {},
): Promise<{ runId: string }> {
	const deps = resolveDependencies(dependencies);
	const runId = deps.id();
	const startedAt = deps.now();
	const lastSuccessfulSync = await latestSuccessfulSync(env.DB);
	const window = planSyncWindow({
		lastSuccessfulSync,
		rangeStart: input.rangeStart,
		rangeEnd: input.rangeEnd,
		force: input.force,
	});
	const counts = emptyCounts();

	await insertSyncRun(env.DB, runId, input, window, startedAt);

	try {
		const settings = await loadSettings(env);
		const commentsDefaultEnabled = await loadCommentsDefaultEnabled(env.DB);
		const pages = input.notionPageId
			? [await retrieveTargetPage(deps.notionSource, settings, input.notionPageId)]
			: await deps.notionSource.listPages(settings, window);

		for (const page of pages) {
			const action = await syncPage(
				env,
				settings,
				runId,
				page,
				input,
				deps,
				commentsDefaultEnabled,
			);
			counts[action] += 1;
		}

		await finishSyncRun(
			env.DB,
			runId,
			counts.failed > 0 ? "partial" : "success",
			counts,
			null,
			deps,
		);

		return { runId };
	} catch (error) {
		await finishSyncRun(env.DB, runId, "failed", counts, error, deps);
		return { runId };
	}
}

async function retrieveTargetPage(
	source: NotionSyncSource,
	settings: SiteSettings,
	pageId: string,
): Promise<NotionSyncPage> {
	if (!source.retrievePage) {
		throw new SyncError(
			"INTERNAL_ERROR",
			"Targeted sync source does not support retrieving a single Notion page",
		);
	}

	return source.retrievePage(settings, pageId);
}

function resolveDependencies(
	overrides: SyncDependencies,
): ResolvedSyncDependencies {
	const fetcher = overrides.fetcher ?? defaultFetcher;

	return {
		now: overrides.now ?? (() => new Date().toISOString()),
		id: overrides.id ?? (() => crypto.randomUUID()),
		fetcher,
		notionSource: overrides.notionSource ?? defaultNotionSource(fetcher),
	};
}

function defaultNotionSource(fetcher: NotionFetcher): NotionSyncSource {
	return {
		async listPages(settings, window) {
			const client = new NotionClient(settings.notionToken, { fetcher });
			return client.queryDatabaseOrDataSourcePages<NotionSyncPage>(
				settings.notionDatabaseId,
				notionQueryBodyForWindow(window),
			);
		},
		async retrievePage(settings, pageId) {
			const client = new NotionClient(settings.notionToken, { fetcher });
			return client.retrievePage<NotionSyncPage>(pageId);
		},
		async listBlocks(settings, pageId) {
			const client = new NotionClient(settings.notionToken, { fetcher });
			return client.listBlockTree(pageId);
		},
	};
}

function notionQueryBodyForWindow(window: SyncWindow): Record<string, unknown> {
	const filters: Record<string, unknown>[] = [];

	if (window.start) {
		filters.push({
			timestamp: "last_edited_time",
			last_edited_time: { on_or_after: window.start },
		});
	}

	if (window.end) {
		filters.push({
			timestamp: "last_edited_time",
			last_edited_time: { on_or_before: window.end },
		});
	}

	if (filters.length === 0) {
		return {};
	}

	return {
		filter: filters.length === 1 ? filters[0] : { and: filters },
	};
}

async function loadSettings(env: AppEnv): Promise<SiteSettings> {
	return parseSettingsFromRows(
		await new SettingsRepository(env.DB).list(),
		env.CONFIG_ENCRYPTION_KEY,
	);
}

async function latestSuccessfulSync(db: D1Database): Promise<string | null> {
	const row = await db
		.prepare(
			`SELECT started_at
			 FROM sync_runs
			 WHERE status = 'success'
			 ORDER BY finished_at DESC
			 LIMIT 1`,
		)
		.first<{ started_at: string }>();

	return row?.started_at ?? null;
}

async function syncPage(
	env: AppEnv,
	settings: SiteSettings,
	runId: string,
	page: NotionSyncPage,
	input: RunSyncInput,
	deps: ResolvedSyncDependencies,
	commentsDefaultEnabled: boolean,
): Promise<SyncAction> {
	const itemId = deps.id();
	const startedAt = deps.now();
	let postId: string | null = null;
	let postPersisted = false;
	let existingBeforeSync = false;

	try {
		const existing = await existingPostState(env.DB, page.id);
		existingBeforeSync = existing !== null;
		const deleted = existing ? null : await deletedPostState(env.DB, page.id);
		if (deleted && !input.force) {
			await insertSyncItem(env.DB, {
				id: itemId,
				runId,
				notionPageId: page.id,
				postId: null,
				action: "skipped",
				status: "skipped",
				startedAt,
				finishedAt: deps.now(),
			});
			return "skipped";
		}
		if (deleted && input.force) {
			await deleteDeletedPostTombstone(env.DB, page.id);
		}

		const metadata = mapNotionPageToPostMetadata(
			page,
			settings.fieldMapping,
			deps.now(),
		);
		postId = existing?.id ?? metadata.id;

		if (
			existing &&
			!input.force &&
			isNotNewerThanExisting(page.last_edited_time, existing.notion_last_edited_time)
		) {
			const metadataForExistingPost = {
				...metadata,
				id: existing.id,
				excerpt: existing.excerpt,
				coverUrl: existing.cover_url,
				notionLastEditedTime: existing.notion_last_edited_time,
			};

			if (postMetadataChanged(existing, metadataForExistingPost)) {
				const action = syncItemActionForVisibility(metadata.visibility);
				await executeBatch(env.DB, [
					prepareUpsertPost(
						env.DB,
						metadataForExistingPost,
						existing.content_hash,
						deps,
						commentsDefaultEnabled,
					),
					...prepareReplacePostTags(
						env.DB,
						metadataForExistingPost.id,
						metadataForExistingPost.tags,
						deps,
					),
					prepareInsertSyncItem(env.DB, {
						id: itemId,
						runId,
						notionPageId: page.id,
						postId: existing.id,
						action,
						status: "success",
						startedAt,
						finishedAt: deps.now(),
					}),
				]);
				postPersisted = true;
				return action;
			}

			await insertSyncItem(env.DB, {
				id: itemId,
				runId,
				notionPageId: page.id,
				postId: existing.id,
				action: "skipped",
				status: "skipped",
				startedAt,
				finishedAt: deps.now(),
			});
			return "skipped";
		}

		if (metadata.visibility === "archived") {
			await executeBatch(env.DB, [
				prepareUpsertPost(
					env.DB,
					{ ...metadata, id: postId, excerpt: existing?.excerpt ?? "" },
					existing?.content_hash ?? null,
					deps,
					commentsDefaultEnabled,
				),
				...prepareReplacePostTags(env.DB, postId, metadata.tags, deps),
				prepareInsertSyncItem(env.DB, {
					id: itemId,
					runId,
					notionPageId: page.id,
					postId,
					action: "archived",
					status: "success",
					startedAt,
					finishedAt: deps.now(),
				}),
			]);
			postPersisted = true;
			return "archived";
		}

		const blocks = await deps.notionSource.listBlocks(settings, page.id);
		const blockSnapshotHash = await normalizedBlocksHash(blocks);
		const existingContent = existing ? await contentState(env.DB, existing.id) : null;

		if (
			existing &&
			existingContent &&
			!input.force &&
			existingContent.block_snapshot_hash === blockSnapshotHash
		) {
			const excerpt = excerptFromMarkdown(existingContent.markdown);
			const coverUrl = await cacheCoverAsset(
				env,
				settings,
				metadata.coverUrl,
				deps,
			);
			await executeBatch(env.DB, [
				prepareUpsertPost(
					env.DB,
					{ ...metadata, id: postId, excerpt, coverUrl },
					existingContent.content_hash,
					deps,
					commentsDefaultEnabled,
				),
				...prepareReplacePostTags(env.DB, postId, metadata.tags, deps),
				prepareInsertSyncItem(env.DB, {
					id: itemId,
					runId,
					notionPageId: page.id,
					postId,
					action: metadata.visibility === "hidden" ? "unpublished" : "metadata_only",
					status: "success",
					startedAt,
					finishedAt: deps.now(),
				}),
			]);
			postPersisted = true;
			return metadata.visibility === "hidden" ? "unpublished" : "metadata_only";
		}

		const assetResult = await uploadPageAssets(env, settings, blocks, deps);
		const markdown = blocksToMarkdown(blocks, { assetUrlMap: assetResult.urlMap });
		const excerpt = excerptFromMarkdown(markdown);
		const contentHash = await sha256Hex(markdown);
		const coverUrl = await cacheCoverAsset(env, settings, metadata.coverUrl, deps);

		await executeBatch(env.DB, [
			prepareUpsertPost(
				env.DB,
				{ ...metadata, id: postId, excerpt, coverUrl },
				contentHash,
				deps,
				commentsDefaultEnabled,
			),
			...prepareReplacePostTags(env.DB, postId, metadata.tags, deps),
			prepareUpsertPostContent(
				env.DB,
				postId,
				markdown,
				blockSnapshotHash,
				contentHash,
				assetResult.resourceRefs,
				deps,
			),
			...prepareReplacePostMedia(
				env.DB,
				postId,
				assetResult.resourceRefs,
				deps,
			),
			prepareInsertSyncItem(env.DB, {
				id: itemId,
				runId,
				notionPageId: page.id,
				postId,
				action: metadata.visibility === "hidden" ? "unpublished" : existing ? "updated" : "created",
				status: "success",
				startedAt,
				finishedAt: deps.now(),
			}),
		]);
		postPersisted = true;

		return metadata.visibility === "hidden" ? "unpublished" : existing ? "updated" : "created";
	} catch (error) {
		if (postId && (postPersisted || existingBeforeSync)) {
			await markPostSyncError(env.DB, postId, publicErrorMessage(error), deps);
		}

		await insertSyncItem(env.DB, {
			id: itemId,
			runId,
			notionPageId: page.id,
			postId: postPersisted ? postId : null,
			action: "skipped",
			status: "failed",
			error,
			startedAt,
			finishedAt: deps.now(),
		});

		return "failed";
	}
}

async function existingPostState(
	db: D1Database,
	notionPageId: string,
): Promise<ExistingPostState | null> {
	return db
		.prepare(
			`SELECT
				id, notion_last_edited_time, content_hash, slug, title, excerpt, cover_url,
				category, status, visibility, published_at
			 FROM posts
			 WHERE notion_page_id = ?
			 LIMIT 1`,
		)
		.bind(notionPageId)
		.first<ExistingPostState>();
}

async function deletedPostState(
	db: D1Database,
	notionPageId: string,
): Promise<DeletedPostState | null> {
	return db
		.prepare(
			`SELECT notion_page_id, post_id, slug, title, deleted_at
			 FROM deleted_posts
			 WHERE notion_page_id = ?
			 LIMIT 1`,
		)
		.bind(notionPageId)
		.first<DeletedPostState>();
}

async function deleteDeletedPostTombstone(
	db: D1Database,
	notionPageId: string,
): Promise<void> {
	await db
		.prepare("DELETE FROM deleted_posts WHERE notion_page_id = ?")
		.bind(notionPageId)
		.run();
}

async function contentState(
	db: D1Database,
	postId: string,
): Promise<ExistingContentState | null> {
	return db
		.prepare(
			`SELECT block_snapshot_hash, content_hash, markdown
			 FROM post_content
			 WHERE post_id = ?
			 LIMIT 1`,
		)
		.bind(postId)
		.first<ExistingContentState>();
}

function isNotNewerThanExisting(
	remoteLastEdited: string | undefined,
	localLastEdited: string,
): boolean {
	if (typeof remoteLastEdited !== "string") {
		return false;
	}

	const remoteTime = Date.parse(remoteLastEdited);
	const localTime = Date.parse(localLastEdited);

	if (Number.isFinite(remoteTime) && Number.isFinite(localTime)) {
		return remoteTime <= localTime;
	}

	return remoteLastEdited <= localLastEdited;
}

function postMetadataChanged(
	existing: ExistingPostState,
	metadata: PostMetadata,
): boolean {
	return (
		existing.slug !== metadata.slug ||
		existing.title !== metadata.title ||
		existing.cover_url !== metadata.coverUrl ||
		existing.category !== metadata.category ||
		existing.status !== metadata.status ||
		existing.visibility !== metadata.visibility ||
		existing.published_at !== metadata.publishedAt ||
		existing.notion_last_edited_time !== metadata.notionLastEditedTime
	);
}

function syncItemActionForVisibility(visibility: PostVisibility): SyncItemAction {
	if (visibility === "archived") {
		return "archived";
	}

	return visibility === "hidden" ? "unpublished" : "metadata_only";
}

async function uploadPageAssets(
	env: AppEnv,
	settings: SiteSettings,
	blocks: NotionBlock[],
	deps: ResolvedSyncDependencies,
): Promise<{
	urlMap: Map<string, string>;
	resourceRefs: ResourceRefRecord[];
}> {
	const cachedByUrl = new Map<string, CachedAsset>();
	const urlMap = new Map<string, string>();
	const resourceRefs: ResourceRefRecord[] = [];

	for (const ref of extractBlockAssetRefs(blocks)) {
		let cached = cachedByUrl.get(ref.url);
		if (!cached) {
			cached = await cacheAsset(env, settings, ref.url, deps);
			cachedByUrl.set(ref.url, cached);
		}

		urlMap.set(ref.url, cached.cdnUrl);
		resourceRefs.push({
			...ref,
			sourceUrl: ref.url,
			cdnUrl: cached.cdnUrl,
			r2Key: cached.r2Key,
			contentHash: cached.contentHash,
		});
	}

	return { urlMap, resourceRefs };
}

async function cacheAsset(
	env: AppEnv,
	settings: SiteSettings,
	sourceUrl: string,
	deps: ResolvedSyncDependencies,
): Promise<CachedAsset> {
	const response = await deps.fetcher(sourceUrl);

	if (!response.ok) {
		throw new SyncError(
			"ASSET_DOWNLOAD_FAILED",
			`Asset download failed with status ${response.status}`,
		);
	}

	const bytes = await response.arrayBuffer();
	const mimeType = response.headers.get("content-type");
	const contentHash = await contentHashForBytes(bytes);
	const r2Key = buildAssetKey(contentHash, mimeType);
	const cdnUrl = cdnUrlForKey(settings.cdnBaseUrl, r2Key);
	const now = deps.now();

	try {
		await uploadAssetIfMissing(env.BLOG_ASSETS, r2Key, bytes, {
			contentType: mimeType ?? undefined,
			cacheControl: "public, max-age=31536000, immutable",
		});
	} catch (error) {
		throw new SyncError("R2_UPLOAD_FAILED", "Asset upload failed", error);
	}

	await env.DB
		.prepare(
			`INSERT INTO assets (
				id, source_fingerprint, notion_file_json, content_hash, r2_key,
				mime_type, size, cdn_url, created_at, last_seen_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(source_fingerprint) DO UPDATE SET
					notion_file_json = excluded.notion_file_json,
					content_hash = excluded.content_hash,
					r2_key = excluded.r2_key,
					mime_type = excluded.mime_type,
					size = excluded.size,
					cdn_url = excluded.cdn_url,
					last_seen_at = excluded.last_seen_at
				ON CONFLICT(r2_key) DO UPDATE SET
					content_hash = excluded.content_hash,
					mime_type = COALESCE(assets.mime_type, excluded.mime_type),
					size = COALESCE(assets.size, excluded.size),
					cdn_url = excluded.cdn_url,
					last_seen_at = excluded.last_seen_at`,
		)
		.bind(
			deps.id(),
			await sourceFingerprint(sourceUrl),
			JSON.stringify({ url: sourceUrl }),
			contentHash,
			r2Key,
			mimeType,
			bytes.byteLength,
			cdnUrl,
			now,
			now,
		)
		.run();

	return {
		sourceUrl,
		cdnUrl,
		r2Key,
		contentHash,
		mimeType,
		size: bytes.byteLength,
	};
}

async function cacheCoverAsset(
	env: AppEnv,
	settings: SiteSettings,
	coverUrl: string | null,
	deps: ResolvedSyncDependencies,
): Promise<string | null> {
	return coverUrl ? (await cacheAsset(env, settings, coverUrl, deps)).cdnUrl : null;
}

function sourceFingerprint(sourceUrl: string): Promise<string> {
	return sha256Hex(sourceUrl);
}

async function insertSyncRun(
	db: D1Database,
	runId: string,
	input: RunSyncInput,
	window: SyncWindow,
	startedAt: string,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO sync_runs (
				id, trigger_type, started_at, status, range_start, range_end, force
			)
			VALUES (?, ?, ?, 'running', ?, ?, ?)`,
		)
		.bind(
			runId,
			input.triggerType,
			startedAt,
			window.start,
			window.end,
			input.force ? 1 : 0,
		)
		.run();
}

async function finishSyncRun(
	db: D1Database,
	runId: string,
	status: "success" | "partial" | "failed",
	counts: SyncCounts,
	error: unknown,
	deps: ResolvedSyncDependencies,
): Promise<void> {
	await db
		.prepare(
			`UPDATE sync_runs SET
				finished_at = ?,
				status = ?,
				created_count = ?,
				updated_count = ?,
				metadata_only_count = ?,
				skipped_count = ?,
				unpublished_count = ?,
				archived_count = ?,
				failed_count = ?,
				error_code = ?,
				error_message = ?
			WHERE id = ?`,
		)
		.bind(
			deps.now(),
			status,
			counts.created,
			counts.updated,
			counts.metadata_only,
			counts.skipped,
			counts.unpublished,
			counts.archived,
			counts.failed,
			error ? syncErrorCode(error) : null,
			publicErrorMessage(error),
			runId,
		)
		.run();
}

function prepareUpsertPost(
	db: D1Database,
	post: PostMetadata,
	contentHash: string | null,
	deps: ResolvedSyncDependencies,
	commentsDefaultEnabled: boolean,
): D1PreparedStatement {
	const now = deps.now();

	return db
		.prepare(
			`INSERT INTO posts (
				id, notion_page_id, slug, title, excerpt, cover_url, category,
				status, visibility, published_at, notion_last_edited_time,
				content_hash, last_sync_error, created_at, updated_at, comments_enabled
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
			ON CONFLICT(notion_page_id) DO UPDATE SET
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
				updated_at = excluded.updated_at`,
		)
		.bind(
			post.id,
			post.notionPageId,
			post.slug,
			post.title,
			post.excerpt,
			post.coverUrl,
			post.category,
			post.status,
			post.visibility,
			post.publishedAt,
			post.notionLastEditedTime,
			contentHash,
			now,
			now,
			commentsDefaultEnabled ? 1 : 0,
		);
}

function prepareUpsertPostContent(
	db: D1Database,
	postId: string,
	markdown: string,
	blockSnapshotHash: string,
	contentHash: string,
	resourceRefs: ResourceRefRecord[],
	deps: ResolvedSyncDependencies,
): D1PreparedStatement {
	const now = deps.now();

	return db
		.prepare(
			`INSERT INTO post_content (
				post_id, markdown, block_snapshot_hash, content_hash,
				resource_refs_json, created_at, updated_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(post_id) DO UPDATE SET
				markdown = excluded.markdown,
				block_snapshot_hash = excluded.block_snapshot_hash,
				content_hash = excluded.content_hash,
				resource_refs_json = excluded.resource_refs_json,
				updated_at = excluded.updated_at`,
		)
		.bind(
			postId,
			markdown,
			blockSnapshotHash,
			contentHash,
			JSON.stringify(resourceRefs),
			now,
			now,
		);
}

function prepareReplacePostMedia(
	db: D1Database,
	postId: string,
	resourceRefs: ResourceRefRecord[],
	deps: ResolvedSyncDependencies,
): D1PreparedStatement[] {
	const now = deps.now();
	const statements = [
		db.prepare("DELETE FROM post_media WHERE post_id = ?").bind(postId),
	];

	for (const [index, ref] of resourceRefs.entries()) {
		const kind = mediaKindForResource(ref.blockType, ref.cdnUrl || ref.sourceUrl);
		if (!kind) {
			continue;
		}

		const blockId =
			typeof ref.blockId === "string" && ref.blockId.trim()
				? ref.blockId.trim()
				: null;
		const stableIdPart = blockId || ref.contentHash || "resource";

		statements.push(
			db
				.prepare(
					`INSERT INTO post_media (
						id, post_id, block_id, kind, url, caption, r2_key,
						content_hash, sort_order, created_at, updated_at
					)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					`${postId}:${stableIdPart}:${index}`,
					postId,
					blockId,
					kind,
					ref.cdnUrl,
					ref.caption,
					ref.r2Key,
					ref.contentHash,
					index,
					now,
					now,
				),
		);
	}

	return statements;
}

function extensionFromUrl(value: string): string {
	try {
		const pathname = new URL(value).pathname.toLowerCase();
		const match = pathname.match(/\.([a-z0-9]+)$/);
		return match?.[1] ?? "";
	} catch {
		const match = value.toLowerCase().match(/\.([a-z0-9]+)(?:[?#]|$)/);
		return match?.[1] ?? "";
	}
}

function mediaKindForResource(
	blockType: string,
	url: string,
): PublicAlbumMediaKind | null {
	const type = blockType.toLowerCase();
	if (type === "image" || type === "video" || type === "audio" || type === "pdf") {
		return type;
	}
	if (type === "file") {
		const extension = extensionFromUrl(url);
		if (["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"].includes(extension)) {
			return "image";
		}
		if (["mp4", "webm", "mov", "m4v"].includes(extension)) {
			return "video";
		}
		if (["mp3", "wav", "ogg", "m4a"].includes(extension)) {
			return "audio";
		}
		if (extension === "pdf") {
			return "pdf";
		}

		return "file";
	}

	return null;
}

function prepareReplacePostTags(
	db: D1Database,
	postId: string,
	tags: string[],
	deps: ResolvedSyncDependencies,
): D1PreparedStatement[] {
	const now = deps.now();
	const statements = [
		db.prepare("DELETE FROM post_tags WHERE post_id = ?").bind(postId),
	];

	for (const [index, tag] of tags.entries()) {
		statements.push(
			db
				.prepare(
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

async function insertSyncItem(
	db: D1Database,
	item: {
		id: string;
		runId: string;
		notionPageId: string;
		postId: string | null;
		action: SyncItemAction;
		status: "success" | "skipped" | "failed";
		error?: unknown;
		startedAt: string;
		finishedAt: string;
	},
): Promise<void> {
	await prepareInsertSyncItem(db, item).run();
}

function prepareInsertSyncItem(db: D1Database, item: {
	id: string;
	runId: string;
	notionPageId: string;
	postId: string | null;
	action: SyncItemAction;
	status: "success" | "skipped" | "failed";
	error?: unknown;
	startedAt: string;
	finishedAt: string;
}): D1PreparedStatement {
	return db
		.prepare(
			`INSERT INTO sync_items (
				id, sync_run_id, notion_page_id, post_id, action, status,
				error_code, error_message, started_at, finished_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(
			item.id,
			item.runId,
			item.notionPageId,
			item.postId,
			item.action,
			item.status,
			item.error ? syncErrorCode(item.error) : null,
			publicErrorMessage(item.error),
			item.startedAt,
			item.finishedAt,
		);
}

async function executeBatch(
	db: D1Database,
	statements: D1PreparedStatement[],
): Promise<void> {
	if (statements.length === 0) {
		return;
	}

	const batch = (
		db as {
			batch?: (statements: D1PreparedStatement[]) => Promise<unknown>;
		}
	).batch;

	if (!batch) {
		throw new SyncError(
			"INTERNAL_ERROR",
			"D1 batch support is required for page sync commits",
		);
	}

	await batch.call(db, statements);
}

async function markPostSyncError(
	db: D1Database,
	postId: string,
	message: string | null,
	deps: ResolvedSyncDependencies,
): Promise<void> {
	await db
		.prepare(
			`UPDATE posts
			 SET last_sync_error = ?, updated_at = ?
			 WHERE id = ?`,
		)
		.bind(message, deps.now(), postId)
		.run();
}

function emptyCounts(): SyncCounts {
	return {
		created: 0,
		updated: 0,
		metadata_only: 0,
		skipped: 0,
		unpublished: 0,
		archived: 0,
		failed: 0,
	};
}

function propertyValue(property: unknown): unknown {
	if (!isRecord(property)) {
		return null;
	}

	switch (property.type) {
		case "title":
			return richText(property.title);
		case "rich_text":
			return richText(property.rich_text);
		case "status":
			return selectName(property.status);
		case "select":
			return selectName(property.select);
		case "multi_select":
			return Array.isArray(property.multi_select)
				? property.multi_select
						.map(selectName)
						.filter((value): value is string => typeof value === "string")
				: [];
		case "date":
			return dateStart(property.date);
		case "checkbox":
			return property.checkbox === true;
		case "files":
			return fileUrlProperty(property);
		case "url":
			return typeof property.url === "string" ? property.url : "";
		case "formula":
			return formulaValue(property.formula);
		default:
			return null;
	}
}

function stringProperty(property: unknown): string {
	const value = propertyValue(property);

	return typeof value === "string" ? value.trim() : "";
}

function dateProperty(property: unknown): string | null {
	const value = propertyValue(property);

	return typeof value === "string" && value.length > 0 ? value : null;
}

function tagProperty(property: unknown): string[] {
	const value = propertyValue(property);

	if (Array.isArray(value)) {
		return normalizeTags(value);
	}

	if (typeof value === "string") {
		return normalizeTags([value]);
	}

	return [];
}

function categoryProperty(property: unknown): string | null {
	const value = propertyValue(property);

	if (Array.isArray(value)) {
		return normalizeTags(value)[0] ?? null;
	}

	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	return null;
}

function normalizeTags(values: unknown[]): string[] {
	const tags: string[] = [];
	const seen = new Set<string>();

	for (const value of values) {
		if (typeof value !== "string") {
			continue;
		}

		const tag = value.trim();
		if (!tag || seen.has(tag)) {
			continue;
		}

		seen.add(tag);
		tags.push(tag);
	}

	return tags;
}

function pageCoverUrl(page: NotionSyncPage): string | null {
	return isRecord(page.cover) ? fileObjectUrl(page.cover) : null;
}

function fileUrlProperty(property: unknown): string | null {
	if (!isRecord(property)) {
		return null;
	}

	if (Array.isArray(property.files)) {
		for (const file of property.files) {
			if (isRecord(file)) {
				const url = fileObjectUrl(file);
				if (url) {
					return url;
				}
			}
		}
	}

	return fileObjectUrl(property);
}

function fileObjectUrl(value: Record<string, unknown>): string | null {
	if (typeof value.url === "string") {
		return value.url;
	}

	for (const key of ["file", "external", "uploaded_file", "upload", value.type]) {
		if (typeof key !== "string") {
			continue;
		}

		const nested = value[key];
		if (isRecord(nested) && typeof nested.url === "string") {
			return nested.url;
		}
	}

	return null;
}

function richText(value: unknown): string {
	return Array.isArray(value)
		? value
				.map((item) =>
					isRecord(item) && typeof item.plain_text === "string"
						? item.plain_text
						: "",
				)
				.join("")
				.trim()
		: "";
}

function selectName(value: unknown): string | null {
	return isRecord(value) && typeof value.name === "string" ? value.name : null;
}

function dateStart(value: unknown): string | null {
	return isRecord(value) && typeof value.start === "string" ? value.start : null;
}

function formulaValue(value: unknown): string {
	if (!isRecord(value)) {
		return "";
	}

	for (const key of ["string", "number", "boolean"]) {
		const item = value[key];
		if (
			typeof item === "string" ||
			typeof item === "number" ||
			typeof item === "boolean"
		) {
			return String(item);
		}
	}

	if (isRecord(value.date)) {
		return dateStart(value.date) ?? "";
	}

	return "";
}

function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function syncErrorCode(error: unknown): ApiErrorCode {
	if (error instanceof SyncError) {
		return error.code;
	}

	if (error instanceof NotionApiError) {
		if (error.status === 401 || error.status === 403) {
			return "NOTION_AUTH_FAILED";
		}
		if (error.status === 404) {
			return "NOTION_DATABASE_NOT_FOUND";
		}
		if (error.status === 429) {
			return "NOTION_RATE_LIMITED";
		}
	}

	return "INTERNAL_ERROR";
}

function publicErrorMessage(error: unknown): string | null {
	if (!error) {
		return null;
	}

	const raw = error instanceof Error ? error.message : String(error);
	const [publicMessage] = raw.split(":");

	return publicMessage.trim() || "Sync failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
