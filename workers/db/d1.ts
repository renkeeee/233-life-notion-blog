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
	cover_url: string | null;
	status: string;
	visibility: PostVisibility;
	published_at: string | null;
	updated_at: string;
};

type ListPublishedOptions = {
	page: number;
	limit: number;
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
	"cover_url",
	"status",
	"visibility",
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
		coverUrl: row.cover_url,
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
	q?: string;
}): { joins: string; where: string; values: unknown[] } {
	const clauses = ["p.visibility = 'published'"];
	const values: unknown[] = [];
	const q = options.q?.trim();

	let joins = "";

	if (q) {
		joins = "LEFT JOIN post_content pc ON pc.post_id = p.id";
		const pattern = likePattern(q);
		clauses.push(
			`(
				p.title LIKE ? ESCAPE '\\'
				OR COALESCE(pc.markdown, '') LIKE ? ESCAPE '\\'
			)`,
		);
		values.push(pattern, pattern);
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
					OR COALESCE(pc.markdown, '') LIKE ? ESCAPE '\\'
				 )
				 ORDER BY p.published_at DESC, p.updated_at DESC
				 LIMIT ?`,
			)
			.bind(pattern, pattern, limit)
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
