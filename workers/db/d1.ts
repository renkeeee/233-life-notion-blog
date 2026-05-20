import type { SettingRow } from "../settings";
import type {
	PostVisibility,
	PublicPostComment,
	PublicPostRecord,
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
	created_at: string;
};

export type LockedPostRecord = {
	id: string;
	slug: string;
	title: string;
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
				`SELECT id, nickname, body, created_at
				 FROM post_comments
				 WHERE post_id = ?
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
		now: string;
	}): Promise<PublicPostComment> {
		await this.db
			.prepare(
				`INSERT INTO post_comments (id, post_id, nickname, body, created_at)
				 VALUES (?, ?, ?, ?, ?)`,
			)
			.bind(input.id, input.postId, input.nickname, input.body, input.now)
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
				`SELECT id, slug, title, lock_password_encrypted
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
				lock_password_encrypted: string | null;
			}>();

		return row
			? {
					id: row.id,
					slug: row.slug,
					title: row.title,
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
