import type { SettingRow } from "../settings";
import type { PostVisibility, PublicPostRecord } from "../types";

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
	summary: string | null;
	cover_url: string | null;
	tags_json: string | null;
	status: string;
	visibility: PostVisibility;
	published_at: string | null;
	updated_at: string;
};

type TagCount = {
	tag: string;
	count: number;
};

type ListPublishedOptions = {
	page: number;
	limit: number;
	tag?: string;
	q?: string;
};

type ListPublishedResult = {
	items: PublicPostRecord[];
	total: number;
};

const publicPostColumnNames = [
	"id",
	"slug",
	"title",
	"summary",
	"cover_url",
	"tags_json",
	"status",
	"visibility",
	"published_at",
	"updated_at",
] as const;

const publicPostColumns = publicPostColumnNames.join(", ");
const sqlTrimWhitespaceChars =
	"char(9) || char(10) || char(11) || char(12) || char(13) || ' '";

function aliasedPublicPostColumns(alias: string): string {
	return publicPostColumnNames.map((column) => `${alias}.${column}`).join(", ");
}

function trimSqlExpression(valueSql: string): string {
	return `trim(${valueSql}, ${sqlTrimWhitespaceChars})`;
}

function parseTagsJson(tagsJson: string | null): string[] {
	if (!tagsJson) {
		return [];
	}

	try {
		const parsed = JSON.parse(tagsJson);
		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed
			.filter((tag): tag is string => typeof tag === "string")
			.map((tag) => tag.trim())
			.filter((tag) => tag.length > 0);
	} catch {
		return [];
	}
}

function mapPostRow(row: PostRow): PublicPostRecord {
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		summary: row.summary,
		coverUrl: row.cover_url,
		tags: parseTagsJson(row.tags_json),
		status: row.status,
		visibility: row.visibility,
		publishedAt: row.published_at,
		updatedAt: row.updated_at,
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

function publishedFilters(options: {
	tag?: string;
	q?: string;
}): { joins: string; where: string; values: unknown[] } {
	const clauses = ["p.visibility = 'published'"];
	const values: unknown[] = [];
	const q = options.q?.trim();
	const tag = options.tag?.trim();

	let joins = "";

	if (tag) {
		const normalizedTagSql = trimSqlExpression("tag.value");
		clauses.push(
			`EXISTS (
				SELECT 1
				FROM json_each(
					CASE
						WHEN json_valid(p.tags_json) THEN
							CASE
								WHEN json_type(p.tags_json) = 'array' THEN p.tags_json
								ELSE '[]'
							END
						ELSE '[]'
					END
				) AS tag
				WHERE typeof(tag.value) = 'text'
				AND ${normalizedTagSql} <> ''
				AND ${normalizedTagSql} = ?
			)`,
		);
		values.push(tag);
	}

	if (q) {
		joins = "LEFT JOIN post_content pc ON pc.post_id = p.id";
		const pattern = likePattern(q);
		clauses.push(
			`(
				p.title LIKE ? ESCAPE '\\'
				OR COALESCE(p.summary, '') LIKE ? ESCAPE '\\'
				OR p.tags_json LIKE ? ESCAPE '\\'
				OR COALESCE(pc.markdown, '') LIKE ? ESCAPE '\\'
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

		return {
			items: itemResult.results.map(mapPostRow),
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
				 WHERE p.visibility = 'published'
				 AND (
					p.title LIKE ? ESCAPE '\\'
					OR COALESCE(p.summary, '') LIKE ? ESCAPE '\\'
					OR p.tags_json LIKE ? ESCAPE '\\'
					OR COALESCE(pc.markdown, '') LIKE ? ESCAPE '\\'
				 )
				 ORDER BY p.published_at DESC, p.updated_at DESC
				 LIMIT ?`,
			)
			.bind(pattern, pattern, pattern, pattern, limit)
			.all<PostRow>();

		return result.results.map(mapPostRow);
	}

	async findPublishedBySlug(slug: string): Promise<PublicPostRecord | null> {
		const row = await this.db
			.prepare(
				`SELECT ${publicPostColumns}
				 FROM posts
				 WHERE slug = ? AND visibility = 'published'
				 LIMIT 1`,
			)
			.bind(slug)
			.first<PostRow>();

		return row ? mapPostRow(row) : null;
	}

	async tagCounts(): Promise<TagCount[]> {
		const normalizedTagSql = trimSqlExpression("tag.value");
		const result = await this.db
			.prepare(
				`SELECT ${normalizedTagSql} AS tag, COUNT(*) AS count
				 FROM posts p,
				 json_each(
					CASE
						WHEN json_valid(p.tags_json) THEN
							CASE
								WHEN json_type(p.tags_json) = 'array' THEN p.tags_json
								ELSE '[]'
							END
						ELSE '[]'
					END
				 ) AS tag
				 WHERE p.visibility = 'published'
				 AND typeof(tag.value) = 'text'
				 AND ${normalizedTagSql} <> ''
				 GROUP BY ${normalizedTagSql}
				 ORDER BY count DESC, tag ASC`,
			)
			.all<TagCount>();

		return result.results.map((row) => ({
			tag: row.tag,
			count: Number(row.count),
		}));
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
