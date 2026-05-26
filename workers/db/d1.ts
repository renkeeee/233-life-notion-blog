import type { SettingRow } from "../settings";
import type {
	PublicAlbumCollectionRecord,
	PublicAlbumList,
	PublicAlbumMediaRecord,
	PostVisibility,
	PublicPostComment,
	PublicPostRecord,
	PostSourceType,
} from "../types";

const upsertSettingSql = `INSERT INTO settings (key, value, encrypted, updated_at)
 VALUES (?, ?, ?, ?)
 ON CONFLICT(key) DO UPDATE SET
 value = excluded.value,
 encrypted = excluded.encrypted,
 updated_at = excluded.updated_at`;

export class SettingsRepository {
	constructor(private readonly db: D1Database) {}

	async get(key: string): Promise<SettingRow | null> {
		return this.db
			.prepare(
				"SELECT key, value, encrypted, updated_at FROM settings WHERE key = ?",
			)
			.bind(key)
			.first<SettingRow>();
	}

	async list(): Promise<SettingRow[]> {
		const result = await this.db
			.prepare("SELECT key, value, encrypted, updated_at FROM settings ORDER BY key")
			.all<SettingRow>();

		return result.results;
	}

	async put(row: SettingRow): Promise<void> {
		await this.preparePut(row).run();
	}

	async putMany(rows: SettingRow[]): Promise<void> {
		const statements = rows.map((row) => this.preparePut(row));

		if (statements.length === 0) {
			return;
		}

		const batch = (
			this.db as {
				batch?: (statements: D1PreparedStatement[]) => Promise<unknown>;
			}
		).batch;

		if (batch) {
			await batch.call(this.db, statements);
			return;
		}

		for (const statement of statements) {
			await statement.run();
		}
	}

	private preparePut(row: SettingRow): D1PreparedStatement {
		return this.db
			.prepare(upsertSettingSql)
			.bind(row.key, row.value, row.encrypted, row.updated_at);
	}
}

type PostRow = {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	cover_url: string | null;
	category: string | null;
	status: string;
	visibility: PostVisibility;
	source_type: PostSourceType | null;
	locked: number | boolean;
	comments_enabled: number | boolean;
	published_at: string | null;
	updated_at: string;
};

type ListPublishedOptions = {
	page: number;
	limit: number;
	q?: string;
	tag?: string;
	category?: string;
};

type ListPublishedResult = {
	items: PublicPostRecord[];
	total: number;
};

type PublicPostDetailRecord = {
	post: PublicPostRecord;
	markdown: string;
};

type CommentRow = {
	id: string;
	nickname: string;
	body: string;
	reply_body: string | null;
	reply_created_at: string | null;
	created_at: string;
};

type AlbumMediaRow = PostRow & {
	media_id: string;
	media_kind: PublicAlbumMediaRecord["kind"];
	media_url: string;
	media_caption: string;
};

type AlbumItemRow = {
	album_id: string;
	album_kind: PublicAlbumMediaRecord["kind"];
	album_url: string;
	album_thumbnail_url: string | null;
	album_large_url: string | null;
	album_title: string;
	album_description: string;
	album_caption: string;
	album_taken_at: string | null;
	album_location_name: string;
	album_latitude: number | null;
	album_longitude: number | null;
	album_featured: number | boolean;
	album_updated_at: string;
	post_id: string | null;
	post_slug: string | null;
	post_title: string | null;
	post_category: string | null;
	post_published_at: string | null;
	post_updated_at: string | null;
};

type AlbumCollectionRow = {
	id: string;
	slug: string;
	title: string;
	description: string;
	cover_item_id: string | null;
	sort_order: number;
};

type ListAlbumOptions = {
	page: number;
	limit: number;
	kind?: PublicAlbumMediaRecord["kind"];
	collection?: string;
	featured?: boolean;
	year?: number;
	month?: number;
};

export type LockedPostRecord = {
	id: string;
	slug: string;
	title: string;
	sourceType: PostSourceType;
	lockPasswordEncrypted: string | null;
};

export type PublicTagRecord = {
	name: string;
	count: number;
};

export type PublicCategoryRecord = PublicTagRecord;

const publicPostColumnNames = [
	"id",
	"slug",
	"title",
	"excerpt",
	"cover_url",
	"category",
	"status",
	"visibility",
	"source_type",
	"locked",
	"comments_enabled",
	"published_at",
	"updated_at",
] as const;

const publicPostColumns = publicPostColumnNames.join(", ");

function aliasedPublicPostColumns(alias: string): string {
	return publicPostColumnNames.map((column) => `${alias}.${column}`).join(", ");
}

function mapPostRow(row: PostRow): PublicPostRecord {
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		excerpt: row.excerpt,
		coverUrl: row.cover_url,
		category: row.category,
		tags: [],
		status: row.status,
		visibility: row.visibility,
		sourceType: row.source_type ?? "notion",
		locked: row.locked === 1 || row.locked === true,
		commentsEnabled:
			row.comments_enabled === 1 || row.comments_enabled === true,
		publishedAt: row.published_at,
		updatedAt: row.updated_at,
	};
}

function mapCommentRow(row: CommentRow): PublicPostComment {
	return {
		id: row.id,
		nickname: row.nickname,
		body: row.body,
		...(row.reply_body ? { replyBody: row.reply_body } : {}),
		...(row.reply_created_at ? { replyCreatedAt: row.reply_created_at } : {}),
		createdAt: row.created_at,
	};
}

function hideLockedPreview(post: PublicPostRecord): PublicPostRecord {
	if (post.locked !== true) {
		return post;
	}

	return {
		...post,
		excerpt: "",
		coverUrl: null,
	};
}

function escapeLike(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("%", "\\%")
		.replaceAll("_", "\\_");
}

function likePattern(value: string): string {
	return `%${escapeLike(value)}%`;
}

const publicVisibilityClauses = [
	"p.visibility = 'published'",
	"p.manual_visibility = 'visible'",
] as const;

const publicUnlockedClauses = [
	...publicVisibilityClauses,
	"p.locked = 0",
] as const;

function publishedFilters(options: {
	q?: string;
	tag?: string;
	category?: string;
}): { joins: string; where: string; values: unknown[] } {
	const clauses: string[] = [...publicVisibilityClauses];
	const values: unknown[] = [];
	const q = options.q?.trim();
	const tag = options.tag?.trim();
	const category = options.category?.trim();

	let joins = "";

	if (tag) {
		joins += "JOIN post_tags filter_tags ON filter_tags.post_id = p.id AND filter_tags.tag = ?\n";
		values.push(tag);
	}

	if (category) {
		clauses.push("p.category = ?");
		values.push(category);
	}

	if (q) {
		joins += "LEFT JOIN post_content pc ON pc.post_id = p.id";
		const pattern = likePattern(q);
		clauses.push(
			`(
				p.title LIKE ? ESCAPE '\\'
				OR COALESCE(p.category, '') LIKE ? ESCAPE '\\'
				OR (
					p.locked = 0
					AND COALESCE(pc.markdown, '') LIKE ? ESCAPE '\\'
				)
				OR EXISTS (
					SELECT 1
					FROM post_tags search_tags
					WHERE search_tags.post_id = p.id
					AND search_tags.tag LIKE ? ESCAPE '\\'
				)
			)`,
		);
		values.push(pattern, pattern, pattern, pattern);
	}

	return {
		joins,
		where: clauses.join("\n\t\t\t\t\t AND "),
		values,
	};
}

export class PostsRepository {
	constructor(private readonly db: D1Database) {}

	async listPublished(
		options: ListPublishedOptions = { page: 1, limit: 20 },
	): Promise<ListPublishedResult> {
		const offset = (options.page - 1) * options.limit;
		const filters = publishedFilters(options);
		const itemResult = await this.db
			.prepare(
				`SELECT DISTINCT ${aliasedPublicPostColumns("p")}
				 FROM posts p
				 ${filters.joins}
				 WHERE ${filters.where}
				 ORDER BY p.published_at DESC, p.updated_at DESC
				 LIMIT ? OFFSET ?`,
			)
			.bind(...filters.values, options.limit, offset)
			.all<PostRow>();
		const countRow = await this.db
			.prepare(
				`SELECT COUNT(DISTINCT p.id) AS total
				 FROM posts p
				 ${filters.joins}
				 WHERE ${filters.where}`,
			)
			.bind(...filters.values)
			.first<{ total: number }>();

		const items = await this.withTags(itemResult.results.map(mapPostRow));

		return {
			items: items.map(hideLockedPreview),
			total: Number(countRow?.total ?? 0),
		};
	}

	async searchPublished(query: string, limit = 20): Promise<PublicPostRecord[]> {
		const pattern = likePattern(query);
		const result = await this.db
			.prepare(
				`SELECT DISTINCT ${aliasedPublicPostColumns("p")}
				 FROM posts p
				 LEFT JOIN post_content pc ON pc.post_id = p.id
				 WHERE ${publicVisibilityClauses.join(" AND ")}
				 AND (
					p.title LIKE ? ESCAPE '\\'
					OR COALESCE(p.category, '') LIKE ? ESCAPE '\\'
					OR (
						p.locked = 0
						AND COALESCE(pc.markdown, '') LIKE ? ESCAPE '\\'
					)
					OR EXISTS (
						SELECT 1
						FROM post_tags search_tags
						WHERE search_tags.post_id = p.id
						AND search_tags.tag LIKE ? ESCAPE '\\'
					)
				 )
				 ORDER BY p.published_at DESC, p.updated_at DESC
				 LIMIT ?`,
			)
			.bind(pattern, pattern, pattern, pattern, limit)
			.all<PostRow>();

		const posts = await this.withTags(result.results.map(mapPostRow));
		return posts.map(hideLockedPreview);
	}

	async findPublishedBySlug(slug: string): Promise<PublicPostRecord | null> {
		const row = await this.db
			.prepare(
				`SELECT ${publicPostColumns}
				 FROM posts
				 WHERE slug = ?
				 AND visibility = 'published'
				 AND manual_visibility = 'visible'
				 AND locked = 0
				 LIMIT 1`,
			)
			.bind(slug)
			.first<PostRow>();

		if (!row) {
			return null;
		}

		const [post] = await this.withTags([mapPostRow(row)]);
		return post ?? null;
	}

	async findPublishedDetailBySlug(
		slug: string,
	): Promise<PublicPostDetailRecord | null> {
		const row = await this.db
			.prepare(
				`SELECT ${aliasedPublicPostColumns("p")}, pc.markdown
				 FROM posts p
				 JOIN post_content pc ON pc.post_id = p.id
				 WHERE p.slug = ?
				 AND p.visibility = 'published'
				 AND p.manual_visibility = 'visible'
				 AND p.locked = 0
				 LIMIT 1`,
			)
			.bind(slug)
			.first<PostRow & { markdown: string }>();

		if (!row) {
			return null;
		}

		const [post] = await this.withTags([mapPostRow(row)]);
		if (!post) {
			return null;
		}

		return { post, markdown: row.markdown };
	}

	async commentsForPost(postId: string): Promise<PublicPostComment[]> {
		const result = await this.db
			.prepare(
				`SELECT id, nickname, body, reply_body, reply_created_at, created_at
				 FROM post_comments
				 WHERE post_id = ?
				 AND moderation_status = 'approved'
				 ORDER BY created_at ASC`,
			)
			.bind(postId)
			.all<CommentRow>();

		return result.results.map(mapCommentRow);
	}

	async createComment(input: {
		id: string;
		postId: string;
		nickname: string;
		body: string;
		moderationStatus?: "pending" | "approved";
		now: string;
	}): Promise<PublicPostComment> {
		const moderationStatus = input.moderationStatus ?? "approved";
		await this.db
			.prepare(
				`INSERT INTO post_comments (
					id, post_id, nickname, body, moderation_status, created_at
				 )
				 VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				input.id,
				input.postId,
				input.nickname,
				input.body,
				moderationStatus,
				input.now,
			)
			.run();

		return {
			id: input.id,
			nickname: input.nickname,
			body: input.body,
			createdAt: input.now,
		};
	}

	async findLockedBySlug(slug: string): Promise<LockedPostRecord | null> {
		const row = await this.db
			.prepare(
				`SELECT id, slug, title, source_type, lock_password_encrypted
				 FROM posts p
				 WHERE p.slug = ?
				 AND p.visibility = 'published'
				 AND p.manual_visibility = 'visible'
				 AND p.locked = 1
				 LIMIT 1`,
			)
			.bind(slug)
			.first<{
				id: string;
				slug: string;
				title: string;
				source_type: PostSourceType | null;
				lock_password_encrypted: string | null;
			}>();

		return row
			? {
					id: row.id,
					slug: row.slug,
					title: row.title,
					sourceType: row.source_type ?? "notion",
					lockPasswordEncrypted: row.lock_password_encrypted,
				}
			: null;
	}

	async findLockedDetailBySlug(
		slug: string,
	): Promise<PublicPostDetailRecord | null> {
		const row = await this.db
			.prepare(
				`SELECT ${aliasedPublicPostColumns("p")}, pc.markdown
				 FROM posts p
				 JOIN post_content pc ON pc.post_id = p.id
				 WHERE p.slug = ?
				 AND p.visibility = 'published'
				 AND p.manual_visibility = 'visible'
				 AND p.locked = 1
				 LIMIT 1`,
			)
			.bind(slug)
			.first<PostRow & { markdown: string }>();

		if (!row) {
			return null;
		}

		const [post] = await this.withTags([mapPostRow(row)]);
		if (!post) {
			return null;
		}

		return { post, markdown: row.markdown };
	}

	async listPublishedForSitemap(limit = 50000): Promise<PublicPostRecord[]> {
		const result = await this.db
			.prepare(
				`SELECT ${aliasedPublicPostColumns("p")}
				 FROM posts p
				 WHERE ${publicUnlockedClauses.join(" AND ")}
				 ORDER BY p.published_at DESC, p.updated_at DESC
				 LIMIT ?`,
			)
			.bind(limit)
			.all<PostRow>();

		return result.results.map(mapPostRow);
	}

	async listPublishedForFeed(limit = 50): Promise<PublicPostRecord[]> {
		const result = await this.db
			.prepare(
				`SELECT ${aliasedPublicPostColumns("p")}
				 FROM posts p
				 WHERE ${publicUnlockedClauses.join(" AND ")}
				 ORDER BY p.published_at DESC, p.updated_at DESC
				 LIMIT ?`,
			)
			.bind(limit)
			.all<PostRow>();

		return this.withTags(result.results.map(mapPostRow));
	}

	async listPublishedForArchive(limit = 50000): Promise<PublicPostRecord[]> {
		const result = await this.db
			.prepare(
				`SELECT ${aliasedPublicPostColumns("p")}
				 FROM posts p
				 WHERE ${publicVisibilityClauses.join(" AND ")}
				 ORDER BY p.published_at DESC, p.updated_at DESC
				 LIMIT ?`,
			)
			.bind(limit)
			.all<PostRow>();

		const posts = await this.withTags(result.results.map(mapPostRow));
		return posts.map(hideLockedPreview);
	}

	async listPublicAlbum(
		options: ListAlbumOptions = { page: 1, limit: 30 },
	): Promise<PublicAlbumList> {
		const offset = (options.page - 1) * options.limit;
		const values: unknown[] = [];
		const clauses = [
			"ai.visibility = 'visible'",
			`(
				ai.post_id IS NULL
				OR (
					p.id IS NOT NULL
					AND p.visibility = 'published'
					AND p.manual_visibility = 'visible'
					AND p.locked = 0
				)
			)`,
		];

		if (options.kind) {
			clauses.push("ai.kind = ?");
			values.push(options.kind);
		}

		if (options.featured === true) {
			clauses.push("ai.featured = 1");
		}

		if (options.year) {
			clauses.push("substr(COALESCE(ai.taken_at, ai.updated_at), 1, 4) = ?");
			values.push(String(options.year));
		}

		if (options.month) {
			clauses.push("substr(COALESCE(ai.taken_at, ai.updated_at), 6, 2) = ?");
			values.push(String(options.month).padStart(2, "0"));
		}

		if (options.collection) {
			clauses.push(
				`EXISTS (
					SELECT 1
					FROM album_item_collections filter_aic
					JOIN album_collections filter_ac
						ON filter_ac.id = filter_aic.collection_id
					WHERE filter_aic.item_id = ai.id
					AND filter_ac.visibility = 'visible'
					AND filter_ac.slug = ?
				)`,
			);
			values.push(options.collection);
		}

		const result = await this.db
			.prepare(
				`SELECT
					ai.id AS album_id,
					ai.kind AS album_kind,
					ai.url AS album_url,
					ai.thumbnail_url AS album_thumbnail_url,
					ai.large_url AS album_large_url,
					ai.title AS album_title,
					ai.description AS album_description,
					ai.caption AS album_caption,
					ai.taken_at AS album_taken_at,
					ai.location_name AS album_location_name,
					ai.latitude AS album_latitude,
					ai.longitude AS album_longitude,
					ai.featured AS album_featured,
					ai.updated_at AS album_updated_at,
					p.id AS post_id,
					p.slug AS post_slug,
					p.title AS post_title,
					p.category AS post_category,
					p.published_at AS post_published_at,
					p.updated_at AS post_updated_at
				 FROM album_items ai
				 LEFT JOIN posts p ON p.id = ai.post_id
				 WHERE ${clauses.join("\n\t\t\t\t\t AND ")}
				 ORDER BY
					COALESCE(ai.taken_at, ai.updated_at) DESC,
					ai.sort_order ASC,
					ai.id ASC
				 LIMIT ? OFFSET ?`,
			)
			.bind(...values, options.limit + 1, offset)
			.all<AlbumItemRow>();
		const rows = result.results.slice(0, options.limit);
		const postIds = rows
			.map((row) => row.post_id)
			.filter((postId): postId is string => typeof postId === "string");
		const tagsByPostId = postIds.length
			? await this.tagsForPostIds([...new Set(postIds)])
			: new Map<string, string[]>();
		const slugsByItemId = await this.collectionSlugsForAlbumItemIds(
			rows.map((row) => row.album_id),
		);

		return {
			items: rows.map((row) => ({
				id: row.album_id,
				title: row.album_title,
				description: row.album_description,
				postId: row.post_id,
				postSlug: row.post_slug,
				postTitle: row.post_title,
				category: row.post_category,
				tags: row.post_id ? (tagsByPostId.get(row.post_id) ?? []) : [],
				kind: row.album_kind,
				url: row.album_url,
				...(row.album_thumbnail_url
					? { thumbnailUrl: row.album_thumbnail_url }
					: {}),
				...(row.album_large_url ? { largeUrl: row.album_large_url } : {}),
				caption: row.album_caption,
				takenAt: row.album_taken_at,
				locationName: row.album_location_name,
				latitude: row.album_latitude,
				longitude: row.album_longitude,
				featured:
					row.album_featured === 1 || row.album_featured === true,
				collectionSlugs: slugsByItemId.get(row.album_id) ?? [],
				publishedAt: row.post_published_at,
				updatedAt: row.post_updated_at ?? row.album_updated_at,
			})),
			page: options.page,
			limit: options.limit,
			hasMore: result.results.length > options.limit,
			collections: await this.listPublicAlbumCollections(),
		};
	}

	async listPublicAlbumCollections(): Promise<PublicAlbumCollectionRecord[]> {
		const result = await this.db
			.prepare(
				`SELECT id, slug, title, description, cover_item_id, sort_order
				 FROM album_collections
				 WHERE visibility = 'visible'
				 ORDER BY sort_order ASC, title ASC`,
			)
			.all<AlbumCollectionRow>();

		return result.results.map((row) => ({
			id: row.id,
			slug: row.slug,
			title: row.title,
			description: row.description,
			coverItemId: row.cover_item_id,
			sortOrder: Number(row.sort_order),
		}));
	}

	async listPublishedMediaForAlbum(
		limit = 50000,
	): Promise<PublicAlbumMediaRecord[]> {
		const result = await this.db
			.prepare(
				`SELECT
					${aliasedPublicPostColumns("p")},
					pm.id AS media_id,
					pm.kind AS media_kind,
					pm.url AS media_url,
					pm.caption AS media_caption
				 FROM post_media pm
				 JOIN posts p ON p.id = pm.post_id
				 WHERE ${publicUnlockedClauses.join(" AND ")}
				 ORDER BY p.published_at DESC, p.updated_at DESC, pm.sort_order ASC
				 LIMIT ?`,
			)
			.bind(limit)
			.all<AlbumMediaRow>();
		const posts = await this.withTags(result.results.map(mapPostRow));
		const postsById = new Map(posts.map((post) => [post.id, post]));
		const items: PublicAlbumMediaRecord[] = [];

		for (const row of result.results) {
			const post = postsById.get(row.id);
			if (!post) {
				continue;
			}

			items.push({
				id: row.media_id,
				title: row.media_caption || post.title,
				description: "",
				postId: post.id,
				postSlug: post.slug,
				postTitle: post.title,
				category: post.category,
				tags: post.tags,
				kind: row.media_kind,
				url: row.media_url,
				largeUrl: row.media_url,
				caption: row.media_caption,
				takenAt: post.publishedAt ?? post.updatedAt,
				locationName: "",
				latitude: null,
				longitude: null,
				featured: false,
				collectionSlugs: [],
				publishedAt: post.publishedAt,
				updatedAt: post.updatedAt,
			});
		}

		return items;
	}

	async listTags(): Promise<PublicTagRecord[]> {
		const result = await this.db
			.prepare(
				`SELECT pt.tag AS name, COUNT(DISTINCT p.id) AS count
				 FROM post_tags pt
				 JOIN posts p ON p.id = pt.post_id
				 WHERE ${publicVisibilityClauses.join(" AND ")}
				 GROUP BY pt.tag
				 ORDER BY count DESC, pt.tag ASC`,
			)
			.all<{ name: string; count: number }>();

		return result.results.map((row) => ({
			name: row.name,
			count: Number(row.count),
		}));
	}

	async listCategories(): Promise<PublicCategoryRecord[]> {
		const result = await this.db
			.prepare(
				`SELECT p.category AS name, COUNT(DISTINCT p.id) AS count
				 FROM posts p
				 WHERE ${publicVisibilityClauses.join(" AND ")}
				 AND p.category IS NOT NULL
				 AND TRIM(p.category) <> ''
				 GROUP BY p.category
				 ORDER BY count DESC, p.category ASC`,
			)
			.all<{ name: string; count: number }>();

		return result.results.map((row) => ({
			name: row.name,
			count: Number(row.count),
		}));
	}

	private async withTags(
		posts: PublicPostRecord[],
	): Promise<PublicPostRecord[]> {
		if (posts.length === 0) {
			return posts;
		}

		const tagsByPostId = await this.tagsForPostIds(posts.map((post) => post.id));

		return posts.map((post) => ({
			...post,
			tags: tagsByPostId.get(post.id) ?? [],
		}));
	}

	private async tagsForPostIds(postIds: string[]): Promise<Map<string, string[]>> {
		const placeholders = postIds.map(() => "?").join(", ");
		const result = await this.db
			.prepare(
				`SELECT post_id, tag
				 FROM post_tags
				 WHERE post_id IN (${placeholders})
				 ORDER BY post_id ASC, sort_order ASC, tag ASC`,
			)
			.bind(...postIds)
			.all<{ post_id: string; tag: string }>();
		const tagsByPostId = new Map<string, string[]>();

		for (const row of result.results) {
			if (typeof row.post_id !== "string" || typeof row.tag !== "string") {
				continue;
			}

			const tags = tagsByPostId.get(row.post_id) ?? [];
			tags.push(row.tag);
			tagsByPostId.set(row.post_id, tags);
		}

		return tagsByPostId;
	}

	private async collectionSlugsForAlbumItemIds(
		itemIds: string[],
	): Promise<Map<string, string[]>> {
		if (itemIds.length === 0) {
			return new Map();
		}

		const placeholders = itemIds.map(() => "?").join(", ");
		const result = await this.db
			.prepare(
				`SELECT aic.item_id, ac.slug
				 FROM album_item_collections aic
				 JOIN album_collections ac ON ac.id = aic.collection_id
				 WHERE aic.item_id IN (${placeholders})
				 AND ac.visibility = 'visible'
				 ORDER BY aic.item_id ASC, aic.sort_order ASC, ac.sort_order ASC, ac.slug ASC`,
			)
			.bind(...itemIds)
			.all<{ item_id: string; slug: string }>();
		const slugsByItemId = new Map<string, string[]>();

		for (const row of result.results) {
			if (typeof row.item_id !== "string" || typeof row.slug !== "string") {
				continue;
			}

			const slugs = slugsByItemId.get(row.item_id) ?? [];
			slugs.push(row.slug);
			slugsByItemId.set(row.item_id, slugs);
		}

		return slugsByItemId;
	}
}

export class PostContentRepository {
	constructor(private readonly db: D1Database) {}

	async markdownForPost(postId: string): Promise<string | null> {
		const row = await this.db
			.prepare("SELECT markdown FROM post_content WHERE post_id = ? LIMIT 1")
			.bind(postId)
			.first<{ markdown: string }>();

		return row?.markdown ?? null;
	}
}
