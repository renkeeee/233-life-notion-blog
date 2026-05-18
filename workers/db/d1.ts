import type { SettingRow } from "../settings";
import type { PublicPostRecord } from "../api/public";

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
	visibility: string;
	published_at: string | null;
	updated_at: string;
};

type TagCount = {
	tag: string;
	count: number;
};

const publicPostColumns = `id, slug, title, summary, cover_url, tags_json, status, visibility, published_at, updated_at`;

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

export class PostsRepository {
	constructor(private readonly db: D1Database) {}

	async listPublished(): Promise<PublicPostRecord[]> {
		const result = await this.db
			.prepare(
				`SELECT ${publicPostColumns}
				 FROM posts
				 WHERE visibility = 'published'
				 ORDER BY published_at DESC, updated_at DESC`,
			)
			.all<PostRow>();

		return result.results.map(mapPostRow);
	}

	async searchPublished(query: string): Promise<PublicPostRecord[]> {
		const pattern = `%${query}%`;
		const result = await this.db
			.prepare(
				`SELECT p.${publicPostColumns.replaceAll(", ", ", p.")}
				 FROM posts p
				 LEFT JOIN post_content pc ON pc.post_id = p.id
				 WHERE p.visibility = 'published'
				 AND (
					p.title LIKE ?
					OR COALESCE(p.summary, '') LIKE ?
					OR p.tags_json LIKE ?
					OR COALESCE(pc.markdown, '') LIKE ?
				 )
				 ORDER BY p.published_at DESC, p.updated_at DESC`,
			)
			.bind(pattern, pattern, pattern, pattern)
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
		const posts = await this.listPublished();
		const counts = new Map<string, number>();

		for (const post of posts) {
			for (const tag of post.tags) {
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}

		return Array.from(counts.entries())
			.map(([tag, count]) => ({ tag, count }))
			.sort((left, right) => {
				if (right.count !== left.count) {
					return right.count - left.count;
				}

				return left.tag.localeCompare(right.tag);
			});
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
