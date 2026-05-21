/// <reference types="node" />

import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../workers/app";
import {
	handleRss,
	handleRobots,
	handleSitemap,
	handlePublicApi,
	listPostsResponse,
	postDetailResponse,
	rssXmlResponse,
	sitemapXmlResponse,
} from "../workers/api/public";
import { encryptString, generateEncryptionKey } from "../workers/crypto";
import { PostContentRepository, PostsRepository } from "../workers/db/d1";
import schemaSql from "../workers/db/schema.sql?raw";
import type { AppEnv, PublicPostRecord } from "../workers/types";

type WorkerRequest = Parameters<NonNullable<typeof worker.fetch>>[0];

type SqlCall = {
	sql: string;
	values: unknown[];
};

type FakeRows = Record<string, unknown>[];
type SqlInputValue = string | number | bigint | null | Uint8Array;

class FakeD1PreparedStatement {
	private values: unknown[] = [];

	constructor(
		private readonly sql: string,
		private readonly rowsForSql: (sql: string, values: unknown[]) => FakeRows,
		private readonly calls: SqlCall[],
	) {}

	bind(...values: unknown[]): D1PreparedStatement {
		this.values = values;
		return this as unknown as D1PreparedStatement;
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		this.calls.push({ sql: this.sql, values: this.values });
		return (this.rowsForSql(this.sql, this.values)[0] ?? null) as T | null;
	}

	async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
		this.calls.push({ sql: this.sql, values: this.values });
		return {
			results: this.rowsForSql(this.sql, this.values) as T[],
			success: true,
			meta: {},
		} as D1Result<T>;
	}
}

class FakeD1Database {
	readonly calls: SqlCall[] = [];

	constructor(
		private readonly rowsForSql: (sql: string, values: unknown[]) => FakeRows,
	) {}

	prepare(sql: string): D1PreparedStatement {
		return new FakeD1PreparedStatement(
			sql,
			this.rowsForSql,
			this.calls,
		) as unknown as D1PreparedStatement;
	}

	asD1(): D1Database {
		return this as unknown as D1Database;
	}
}

class SqliteD1PreparedStatement {
	private values: unknown[] = [];

	constructor(
		private readonly statement: ReturnType<DatabaseSync["prepare"]>,
		private readonly sql: string,
		private readonly calls: SqlCall[],
	) {}

	bind(...values: unknown[]): D1PreparedStatement {
		this.values = values;
		return this as unknown as D1PreparedStatement;
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		this.calls.push({ sql: this.sql, values: this.values });
		return (
			this.statement.get(...(this.values as SqlInputValue[])) ?? null
		) as T | null;
	}

	async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
		this.calls.push({ sql: this.sql, values: this.values });
		return {
			results: this.statement.all(...(this.values as SqlInputValue[])) as T[],
			success: true,
			meta: {},
		} as D1Result<T>;
	}

	async run(): Promise<D1Result> {
		this.calls.push({ sql: this.sql, values: this.values });
		this.statement.run(...(this.values as SqlInputValue[]));
		return { results: [], success: true, meta: {} } as unknown as D1Result;
	}
}

class SqliteD1Database {
	readonly calls: SqlCall[] = [];
	private readonly db = new DatabaseSync(":memory:");

	constructor() {
		this.db.exec("PRAGMA foreign_keys = ON;");
		this.db.exec(schemaSql);
	}

	prepare(sql: string): D1PreparedStatement {
		return new SqliteD1PreparedStatement(
			this.db.prepare(sql),
			sql,
			this.calls,
		) as unknown as D1PreparedStatement;
	}

	insertPost(row: Record<string, unknown>): void {
		this.db
			.prepare(
				`INSERT INTO posts (
					id, notion_page_id, slug, title, excerpt, cover_url, category,
					status, visibility, published_at, notion_last_edited_time,
					content_hash, last_sync_error, created_at, updated_at,
					comments_enabled
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				...([
					row.id,
					row.notion_page_id,
					row.slug,
					row.title,
					row.excerpt,
					row.cover_url,
					row.category,
					row.status,
					row.visibility,
					row.published_at,
					row.notion_last_edited_time,
					row.content_hash,
					row.last_sync_error,
					row.created_at,
					row.updated_at,
					row.comments_enabled ?? 1,
				] as SqlInputValue[]),
			);
	}

	insertContent(
		postId: string,
		markdown: string,
	): void {
		this.db
			.prepare(
				`INSERT INTO post_content (
					post_id, markdown, block_snapshot_hash, content_hash,
					resource_refs_json, created_at, updated_at
				)
				VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				postId,
				markdown,
				`blocks-${postId}`,
				`content-${postId}`,
				"[]",
				now,
				now,
			);
	}

	insertMedia(
		postId: string,
		overrides: Record<string, unknown> = {},
	): void {
		const row = {
			id: `${postId}:media-1`,
			block_id: "media-1",
			kind: "image",
			url: "https://assets.233.life/assets/media.jpg",
			caption: "",
			r2_key: "assets/media.jpg",
			content_hash: "hash-media",
			sort_order: 0,
			created_at: now,
			updated_at: now,
			...overrides,
		};
		this.db
			.prepare(
				`INSERT INTO post_media (
					id, post_id, block_id, kind, url, caption, r2_key,
					content_hash, sort_order, created_at, updated_at
				)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				row.id as SqlInputValue,
				postId,
				row.block_id as SqlInputValue,
				row.kind as SqlInputValue,
				row.url as SqlInputValue,
				row.caption as SqlInputValue,
				row.r2_key as SqlInputValue,
				row.content_hash as SqlInputValue,
				row.sort_order as SqlInputValue,
				row.created_at as SqlInputValue,
				row.updated_at as SqlInputValue,
			);
	}

	insertTag(postId: string, tag: string, sortOrder = 0): void {
		this.db
			.prepare(
				`INSERT INTO post_tags (
					post_id, tag, sort_order, created_at, updated_at
				)
				VALUES (?, ?, ?, ?, ?)`,
			)
			.run(postId, tag, sortOrder, now, now);
	}

	insertComment(
		postId: string,
		overrides: Record<string, unknown> = {},
	): void {
		const row = {
			id: "comment-1",
			nickname: "Ada",
			body: "A small hello.",
			created_at: "2026-05-03T00:00:00.000Z",
			...overrides,
		};
		this.db
			.prepare(
				`INSERT INTO post_comments (id, post_id, nickname, body, created_at)
				 VALUES (?, ?, ?, ?, ?)`,
			)
			.run(
				row.id as SqlInputValue,
				postId,
				row.nickname as SqlInputValue,
				row.body as SqlInputValue,
				row.created_at as SqlInputValue,
			);
	}

	exec(sql: string): void {
		this.db.exec(sql);
	}

	asD1(): D1Database {
		return this as unknown as D1Database;
	}

	close(): void {
		this.db.close();
	}
}

const now = "2026-05-01T00:00:00.000Z";
const rootKey = generateEncryptionKey();

const publishedPost: PublicPostRecord = {
	id: "post-1",
	slug: "published-post",
	title: "Published post",
	excerpt: "Opening text for the published post.",
	coverUrl: "https://cdn.example.com/cover.jpg",
	category: "Essay",
	tags: ["Life", "Notes"],
	status: "ready",
	visibility: "published",
	publishedAt: "2026-05-01T00:00:00.000Z",
	updatedAt: "2026-05-02T00:00:00.000Z",
};

function publicRequest(pathname: string): Request {
	return new Request(`https://example.test${pathname}`);
}

function envWithDb(db: D1Database): AppEnv {
	return {
		DB: db,
		BLOG_ASSETS: {} as R2Bucket,
		CONFIG_ENCRYPTION_KEY: rootKey,
	};
}

function envWithDbAndAssets(db: D1Database): AppEnv {
	return {
		...envWithDb(db),
		ASSETS: {
			async fetch() {
				return new Response(
					`<!doctype html>
					<html lang="en">
						<head>
							<meta name="description" content="A Notion-backed personal blog." />
							<title>233.life</title>
						</head>
						<body><div id="root"></div></body>
					</html>`,
					{ headers: { "content-type": "text/html; charset=utf-8" } },
				);
			},
		},
	};
}

function envWithTurnstile(db: D1Database): AppEnv {
	return {
		...envWithDb(db),
		TURNSTILE_SITE_KEY: "test-site-key",
		TURNSTILE_SECRET_KEY: "test-secret-key",
		TURNSTILE_SITEVERIFY_URL: "https://turnstile.test/siteverify",
	};
}

function postRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "post-1",
		notion_page_id: "notion-1",
		slug: "published-post",
		title: "Published post",
		excerpt: "Opening text for the published post.",
		cover_url: "https://cdn.example.com/cover.jpg",
		category: "Essay",
		status: "ready",
		visibility: "published",
		comments_enabled: 1,
		published_at: "2026-05-01T00:00:00.000Z",
		notion_last_edited_time: "2026-05-01T12:00:00.000Z",
		content_hash: "hash-1",
		last_sync_error: null,
		created_at: "2026-05-01T00:00:00.000Z",
		updated_at: "2026-05-02T00:00:00.000Z",
		...overrides,
	};
}

describe("public response helpers", () => {
	it("maps repository list results to compact public summaries", () => {
		const response = listPostsResponse(
			{ items: [publishedPost], total: 1 },
			{ page: 1, limit: 10 },
		);

		expect(response).toEqual({
			items: [
				{
					id: "post-1",
					slug: "published-post",
					title: "Published post",
					excerpt: "Opening text for the published post.",
					coverUrl: "https://cdn.example.com/cover.jpg",
					category: "Essay",
					tags: ["Life", "Notes"],
					publishedAt: "2026-05-01T00:00:00.000Z",
					updatedAt: "2026-05-02T00:00:00.000Z",
				},
			],
			total: 1,
			page: 1,
			limit: 10,
		});
	});

	it("returns public metadata and markdown for a post detail", () => {
		expect(postDetailResponse(publishedPost, "# Hello")).toEqual({
			id: "post-1",
			slug: "published-post",
			title: "Published post",
			excerpt: "Opening text for the published post.",
			coverUrl: "https://cdn.example.com/cover.jpg",
			category: "Essay",
			tags: ["Life", "Notes"],
			commentsEnabled: false,
			comments: [],
			publishedAt: "2026-05-01T00:00:00.000Z",
			updatedAt: "2026-05-02T00:00:00.000Z",
			markdown: "# Hello",
		});
	});

	it("renders an anti-index XML sitemap with only the homepage", () => {
		const xml = sitemapXmlResponse(
			[
				{
					...publishedPost,
					slug: "hello world",
					updatedAt: "2026-05-02T00:00:00.000Z",
				},
				{
					...publishedPost,
					id: "post-2",
					slug: "c&c notes",
					updatedAt: "2026-05-03T00:00:00.000Z",
				},
			],
			"https://example.test",
		);

		expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(xml).toContain("<loc>https://example.test/</loc>");
		expect(xml).not.toContain("<loc>https://example.test/post/");
		expect(xml).not.toContain("<lastmod>");
	});

	it("renders an RSS feed for published posts", () => {
		const xml = rssXmlResponse(
			[
				{
					...publishedPost,
					title: "Quiet & Bright",
					slug: "quiet & bright",
					excerpt: "Life <in> quiet moments.",
					category: "Essay",
					tags: ["Life", "Notes"],
					publishedAt: "2026-05-01T00:00:00.000Z",
					updatedAt: "2026-05-02T00:00:00.000Z",
				},
			],
			"https://example.test",
			{ siteTitle: "233.life" },
		);

		expect(xml).toContain('<rss version="2.0"');
		expect(xml).toContain("<title>233.life</title>");
		expect(xml).toContain("<link>https://example.test/</link>");
		expect(xml).toContain("<title>Quiet &amp; Bright</title>");
		expect(xml).toContain(
			"<link>https://example.test/post/quiet%20%26%20bright</link>",
		);
		expect(xml).toContain(
			"<description>Life &lt;in&gt; quiet moments.</description>",
		);
		expect(xml).toContain("<category>Essay</category>");
		expect(xml).toContain("<category>Life</category>");
		expect(xml).toContain("<pubDate>Fri, 01 May 2026 00:00:00 GMT</pubDate>");
	});
});

describe("PostsRepository", () => {
	it("maps snake_case rows to simplified public records", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("COUNT(DISTINCT p.id)")) {
				return [{ total: 2 }];
			}
			return [
				postRow(),
				postRow({
					id: "post-2",
					slug: "without-cover",
					cover_url: null,
				}),
			];
		});
		const repository = new PostsRepository(fakeDb.asD1());

		await expect(repository.listPublished()).resolves.toEqual({
			items: [
				expect.objectContaining({
					id: "post-1",
					coverUrl: "https://cdn.example.com/cover.jpg",
					category: "Essay",
					publishedAt: "2026-05-01T00:00:00.000Z",
					updatedAt: "2026-05-02T00:00:00.000Z",
				}),
				expect.objectContaining({
					id: "post-2",
					slug: "without-cover",
					coverUrl: null,
				}),
			],
			total: 2,
		});
	});

	it("uses published visibility filters and bound search patterns", async () => {
		const fakeDb = new FakeD1Database(() => []);
		const repository = new PostsRepository(fakeDb.asD1());

		await repository.searchPublished("notion api");

		expect(fakeDb.calls[0]?.sql).toContain("visibility = 'published'");
		expect(fakeDb.calls[0]?.sql).toContain("post_content");
		expect(fakeDb.calls[0]?.sql).not.toContain("summary");
		expect(fakeDb.calls[0]?.sql).not.toContain("tags_json");
		expect(fakeDb.calls[0]?.values).toEqual([
			"%notion api%",
			"%notion api%",
			"%notion api%",
			"%notion api%",
			20,
		]);
	});

	it("applies list pagination, search filters, and totals in SQL", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "first-life",
					title: "First SQL Life",
					published_at: "2026-05-03T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "second-life",
					title: "Second SQL Life",
					published_at: "2026-05-02T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-3",
					notion_page_id: "notion-3",
					slug: "hidden-life",
					title: "Hidden SQL Life",
					visibility: "hidden",
					published_at: "2026-05-04T00:00:00.000Z",
				}),
			);
			db.insertContent("post-1", "Body mentions SQL");
			db.insertContent("post-2", "Body mentions SQL");
			db.insertContent("post-3", "Body mentions SQL");

			const result = await new PostsRepository(db.asD1()).listPublished({
				page: 2,
				limit: 1,
				q: "SQL",
			});

			expect(result).toEqual({
				items: [expect.objectContaining({ slug: "second-life" })],
				total: 2,
			});

			const itemQuery = db.calls.find((call) => call.sql.includes("LIMIT ?"));
			const countQuery = db.calls.find((call) =>
				call.sql.includes("COUNT(DISTINCT p.id)"),
			);

			expect(itemQuery?.sql).toContain("ESCAPE '\\'");
			expect(itemQuery?.sql).not.toContain("json_each");
			expect(itemQuery?.values).toEqual([
				"%SQL%",
				"%SQL%",
				"%SQL%",
				"%SQL%",
				1,
				1,
			]);
			expect(countQuery?.values).toEqual([
				"%SQL%",
				"%SQL%",
				"%SQL%",
				"%SQL%",
			]);
		} finally {
			db.close();
		}
	});

	it("excludes manually hidden posts but lists locked titles with hidden summaries", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "visible-life",
					title: "Visible Life",
					excerpt: "Visible opening text.",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "manual-hidden",
					title: "Manual hidden",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-3",
					notion_page_id: "notion-3",
					slug: "locked-life",
					title: "Locked Life",
					excerpt: "Private opening text.",
					cover_url: "https://cdn.example.com/private.jpg",
				}),
			);
			db.exec("UPDATE posts SET manual_visibility = 'hidden' WHERE id = 'post-2'");
			db.exec("UPDATE posts SET locked = 1 WHERE id = 'post-3'");

			const result = await new PostsRepository(db.asD1()).listPublished({
				page: 1,
				limit: 20,
				q: "Life",
			});

			expect(result).toEqual({
				items: [
					expect.objectContaining({
						slug: "visible-life",
						excerpt: "Visible opening text.",
						locked: false,
					}),
					expect.objectContaining({
						slug: "locked-life",
						title: "Locked Life",
						excerpt: "",
						coverUrl: null,
						locked: true,
					}),
				],
				total: 2,
			});
		} finally {
			db.close();
		}
	});

	it("filters published posts by tag and hydrates tag metadata", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "life-post",
					title: "Life post",
					published_at: "2026-05-03T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "tech-post",
					title: "Tech post",
					published_at: "2026-05-02T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-3",
					notion_page_id: "notion-3",
					slug: "hidden-life",
					title: "Hidden life",
					visibility: "hidden",
				}),
			);
			db.insertTag("post-1", "Life", 0);
			db.insertTag("post-1", "Notes", 1);
			db.insertTag("post-2", "Tech", 0);
			db.insertTag("post-3", "Life", 0);

			await expect(
				new PostsRepository(db.asD1()).listPublished({
					page: 1,
					limit: 20,
					tag: "Life",
				}),
			).resolves.toEqual({
				items: [
					expect.objectContaining({
						slug: "life-post",
						tags: ["Life", "Notes"],
					}),
				],
				total: 1,
			});
		} finally {
			db.close();
		}
	});

	it("filters published posts by category and keeps category metadata in results", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "essay-post",
					title: "Essay post",
					category: "Essay",
					published_at: "2026-05-03T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "note-post",
					title: "Note post",
					category: "Note",
					published_at: "2026-05-02T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-3",
					notion_page_id: "notion-3",
					slug: "hidden-essay",
					title: "Hidden essay",
					category: "Essay",
					visibility: "hidden",
				}),
			);

			await expect(
				new PostsRepository(db.asD1()).listPublished({
					page: 1,
					limit: 20,
					category: "Essay",
				}),
			).resolves.toEqual({
				items: [
					expect.objectContaining({
						slug: "essay-post",
						category: "Essay",
					}),
				],
				total: 1,
			});
		} finally {
			db.close();
		}
	});

	it("lists tags with published post counts", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ id: "post-1", notion_page_id: "notion-1" }));
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "second-post",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-3",
					notion_page_id: "notion-3",
					slug: "hidden-post",
					visibility: "hidden",
				}),
			);
			db.insertTag("post-1", "Life", 0);
			db.insertTag("post-2", "Life", 0);
			db.insertTag("post-2", "Notes", 1);
			db.insertTag("post-3", "Life", 0);

			await expect(new PostsRepository(db.asD1()).listTags()).resolves.toEqual([
				{ name: "Life", count: 2 },
				{ name: "Notes", count: 1 },
			]);
		} finally {
			db.close();
		}
	});

	it("lists categories with published post counts", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					category: "Essay",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "second-post",
					category: "Essay",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-3",
					notion_page_id: "notion-3",
					slug: "note-post",
					category: "Note",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-4",
					notion_page_id: "notion-4",
					slug: "hidden-post",
					category: "Essay",
					visibility: "hidden",
				}),
			);

			await expect(new PostsRepository(db.asD1()).listCategories()).resolves.toEqual([
				{ name: "Essay", count: 2 },
				{ name: "Note", count: 1 },
			]);
		} finally {
			db.close();
		}
	});

	it("treats percent, underscore, and backslash as literal search characters", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "literal-percent",
					title: "100% literal",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "plain-title",
					title: "Plain title",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-3",
					notion_page_id: "notion-3",
					slug: "literal-backslash",
					title: String.raw`Path \ literal`,
				}),
			);

			const repository = new PostsRepository(db.asD1());

			await expect(repository.searchPublished("%")).resolves.toEqual([
				expect.objectContaining({ slug: "literal-percent" }),
			]);
			await expect(repository.searchPublished("_")).resolves.toEqual([]);
			await expect(repository.searchPublished("\\")).resolves.toEqual([
				expect.objectContaining({ slug: "literal-backslash" }),
			]);

			const searchCall = db.calls.find((call) =>
				call.sql.includes("post_content"),
			);
			expect(searchCall?.sql).toContain("ESCAPE '\\'");
			expect(searchCall?.values).toEqual([
				"%\\%%",
				"%\\%%",
				"%\\%%",
				"%\\%%",
				20,
			]);
		} finally {
			db.close();
		}
	});

	it("lists published posts for sitemap without hidden posts", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "first-life",
					published_at: "2026-05-03T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "second-life",
					published_at: "2026-05-02T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-3",
					notion_page_id: "notion-3",
					slug: "hidden-life",
					visibility: "hidden",
					published_at: "2026-05-04T00:00:00.000Z",
				}),
			);

			await expect(
				new PostsRepository(db.asD1()).listPublishedForSitemap(),
			).resolves.toEqual([
				expect.objectContaining({ slug: "first-life" }),
				expect.objectContaining({ slug: "second-life" }),
			]);
		} finally {
			db.close();
		}
	});

	it("lists recent published posts for RSS without hidden or locked posts", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "first-life",
					published_at: "2026-05-03T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "second-life",
					published_at: "2026-05-02T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-3",
					notion_page_id: "notion-3",
					slug: "hidden-life",
					visibility: "hidden",
					published_at: "2026-05-04T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-4",
					notion_page_id: "notion-4",
					slug: "locked-life",
					published_at: "2026-05-05T00:00:00.000Z",
				}),
			);
			db.exec("UPDATE posts SET locked = 1 WHERE id = 'post-4'");
			db.insertTag("post-1", "Life");

			await expect(new PostsRepository(db.asD1()).listPublishedForFeed()).resolves
				.toEqual([
					expect.objectContaining({ slug: "first-life", tags: ["Life"] }),
					expect.objectContaining({ slug: "second-life" }),
				]);
		} finally {
			db.close();
		}
	});

	it("lists archive posts without hidden posts and preserves locked titles", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "archive-life",
					published_at: "2026-05-03T00:00:00.000Z",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "hidden-life",
					visibility: "hidden",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-3",
					notion_page_id: "notion-3",
					slug: "locked-life",
				}),
			);
			db.exec("UPDATE posts SET locked = 1 WHERE id = 'post-3'");
			db.insertTag("post-1", "Life");

			const response = await handlePublicApi(
				publicRequest("/api/archive"),
				envWithDb(db.asD1()),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				items: [
					expect.objectContaining({
						slug: "archive-life",
						tags: ["Life"],
					}),
					expect.objectContaining({
						slug: "locked-life",
						excerpt: "",
						coverUrl: null,
						locked: true,
					}),
				],
			});
		} finally {
			db.close();
		}
	});

	it("lists unlocked published media resources for the album", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "media-life",
					title: "Media life",
					category: "Journal",
					published_at: "2026-05-03T00:00:00.000Z",
				}),
			);
			db.insertContent("post-1", "# Media");
			db.insertMedia("post-1", {
					id: "post-1:image-1:0",
					blockId: "image-1",
					block_id: "image-1",
					kind: "image",
					url: "https://assets.233.life/assets/aa/image.jpg",
					r2_key: "assets/aa/image.jpg",
					content_hash: "hash-image",
					caption: "Window light",
					sort_order: 0,
				});
			db.insertMedia("post-1", {
					id: "post-1:video-1:1",
					block_id: "video-1",
					kind: "video",
					url: "https://assets.233.life/assets/bb/video.mp4",
					r2_key: "assets/bb/video.mp4",
					content_hash: "hash-video",
					caption: "",
					sort_order: 1,
				});
			db.insertTag("post-1", "Life");
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "locked-media",
					title: "Locked media",
				}),
			);
			db.insertContent("post-2", "# Private");
			db.insertMedia("post-2", {
					id: "post-2:private-image:0",
					block_id: "private-image",
					kind: "image",
					url: "https://assets.233.life/assets/private.jpg",
					caption: "Private",
					sort_order: 0,
				});
			db.exec("UPDATE posts SET locked = 1 WHERE id = 'post-2'");

			const response = await handlePublicApi(
				publicRequest("/api/album"),
				envWithDb(db.asD1()),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				items: [
					{
						id: "post-1:image-1:0",
						postId: "post-1",
						postSlug: "media-life",
						postTitle: "Media life",
						category: "Journal",
						tags: ["Life"],
						kind: "image",
						url: "https://assets.233.life/assets/aa/image.jpg",
						thumbnailUrl:
							"https://assets.233.life/cdn-cgi/image/width=440,quality=82,format=auto/assets/aa/image.jpg",
						caption: "Window light",
						publishedAt: "2026-05-03T00:00:00.000Z",
						updatedAt: "2026-05-02T00:00:00.000Z",
					},
					{
						id: "post-1:video-1:1",
						postId: "post-1",
						postSlug: "media-life",
						postTitle: "Media life",
						category: "Journal",
						tags: ["Life"],
						kind: "video",
						url: "https://assets.233.life/assets/bb/video.mp4",
						caption: "",
						publishedAt: "2026-05-03T00:00:00.000Z",
						updatedAt: "2026-05-02T00:00:00.000Z",
					},
				],
			});
		} finally {
			db.close();
		}
	});
});

describe("PostContentRepository", () => {
	it("returns markdown content for a post", async () => {
		const fakeDb = new FakeD1Database(() => [{ markdown: "# Published" }]);
		const repository = new PostContentRepository(fakeDb.asD1());

		await expect(repository.markdownForPost("post-1")).resolves.toBe(
			"# Published",
		);
		expect(fakeDb.calls[0]?.values).toEqual(["post-1"]);
	});
});

describe("handlePublicApi", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns health JSON", async () => {
		const fakeDb = new FakeD1Database(() => []);

		const response = await handlePublicApi(
			publicRequest("/api/health"),
			envWithDb(fakeDb.asD1()),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("lists posts with pagination", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("COUNT(DISTINCT p.id)")) {
				return [{ total: 1 }];
			}
			if (sql.includes("SELECT DISTINCT")) {
				return [
					postRow({
						id: "post-1",
						slug: "life-post",
						cover_url:
							"https://assets.233.life/assets/3c/original-cover.jpg",
					}),
				];
			}
			return [];
		});

		const response = await handlePublicApi(
			publicRequest("/api/posts?page=1&limit=1"),
			envWithDb(fakeDb.asD1()),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe(
			"public, no-cache",
		);
		expect(response.headers.get("etag")).toMatch(/^W\/"/);
		const body = await response.json() as {
			items: Array<Record<string, unknown>>;
		};
		expect(body).toEqual({
			items: [
				expect.objectContaining({
					slug: "life-post",
					coverUrl:
						"https://assets.233.life/assets/3c/original-cover.jpg",
					coverThumbnailUrl:
						"https://assets.233.life/cdn-cgi/image/width=440,quality=82,format=auto/assets/3c/original-cover.jpg",
				}),
			],
			total: 1,
			page: 1,
			limit: 1,
		});
	});

	it("returns 304 for matching public API entity tags", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("COUNT(DISTINCT p.id)")) {
				return [{ total: 1 }];
			}
			if (sql.includes("SELECT DISTINCT")) {
				return [postRow({ id: "post-1", slug: "life-post" })];
			}
			return [];
		});
		const env = envWithDb(fakeDb.asD1());
		const firstResponse = await handlePublicApi(
			publicRequest("/api/posts?page=1&limit=1"),
			env,
		);
		const etag = firstResponse.headers.get("etag");
		const secondResponse = await handlePublicApi(
			new Request("https://example.test/api/posts?page=1&limit=1", {
				headers: { "if-none-match": etag ?? "" },
			}),
			env,
		);

		expect(secondResponse.status).toBe(304);
		expect(secondResponse.headers.get("etag")).toBe(etag);
		expect(await secondResponse.text()).toBe("");
	});

	it("can include category counts in the first posts response", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ id: "post-1", notion_page_id: "notion-1", category: "Essay" }));

			const response = await handlePublicApi(
				publicRequest("/api/posts?page=1&limit=20&include=categories"),
				envWithDb(db.asD1()),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual(
				expect.objectContaining({
					categories: [{ name: "Essay", count: 1 }],
				}),
			);
		} finally {
			db.close();
		}
	});

	it("rejects invalid pagination values", async () => {
		const fakeDb = new FakeD1Database(() => []);

		const response = await handlePublicApi(
			publicRequest("/api/posts?page=0&limit=20"),
			envWithDb(fakeDb.asD1()),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "BAD_REQUEST",
				message: "Pagination values must be positive integers",
			},
		});
	});

	it("caps large page limits to the public maximum", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("COUNT(DISTINCT p.id)")) {
				return [{ total: 1 }];
			}
			if (sql.includes("SELECT DISTINCT")) {
				return [postRow()];
			}
			return [];
		});

		const response = await handlePublicApi(
			publicRequest("/api/posts?limit=1000"),
			envWithDb(fakeDb.asD1()),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(
			expect.objectContaining({
				limit: 100,
				total: 1,
			}),
		);
	});

	it("returns one published post with markdown by decoded slug", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("JOIN post_content")) {
				return [
					{ ...postRow({ slug: "hello world" }), markdown: "# Hello world" },
				];
			}
			if (sql.includes("WHERE slug = ?")) {
				return [postRow({ slug: "hello world" })];
			}
			return [];
		});

		const response = await handlePublicApi(
			publicRequest("/api/posts/hello%20world"),
			envWithDb(fakeDb.asD1()),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe(
			"public, no-cache",
		);
		await expect(response.json()).resolves.toEqual({
			id: "post-1",
			slug: "hello world",
			title: "Published post",
			excerpt: "Opening text for the published post.",
			coverUrl: "https://cdn.example.com/cover.jpg",
				category: "Essay",
				tags: [],
				commentsEnabled: true,
				comments: [],
				publishedAt: "2026-05-01T00:00:00.000Z",
				updatedAt: "2026-05-02T00:00:00.000Z",
				markdown: "# Hello world",
			});
		expect(
			fakeDb.calls.some((call) =>
				call.sql.includes("SELECT markdown FROM post_content"),
			),
			).toBe(false);
		});

	it("includes post comments in published post details", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ id: "post-1", slug: "commented-post" }));
			db.insertContent("post-1", "# Commented");
			db.insertComment("post-1", {
				id: "comment-1",
				nickname: "Ada",
				body: "A thoughtful note.",
				created_at: "2026-05-03T00:00:00.000Z",
			});

			const response = await handlePublicApi(
				publicRequest("/api/posts/commented-post"),
				envWithDb(db.asD1()),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual(
				expect.objectContaining({
					commentsEnabled: true,
					comments: [
						{
							id: "comment-1",
							nickname: "Ada",
							body: "A thoughtful note.",
							createdAt: "2026-05-03T00:00:00.000Z",
						},
					],
				}),
			);
		} finally {
			db.close();
		}
	});

	it("only exposes approved comments and includes author replies", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ id: "post-1", slug: "commented-post" }));
			db.insertContent("post-1", "# Commented");
			db.exec(
				`INSERT INTO post_comments (
					id, post_id, nickname, body, moderation_status,
					reply_body, reply_created_at, created_at
				)
				VALUES (
					'comment-approved', 'post-1', 'Ada', 'A thoughtful note.',
					'approved', 'Thanks for reading.', '2026-05-04T00:00:00.000Z',
					'2026-05-03T00:00:00.000Z'
				), (
					'comment-pending', 'post-1', 'Grace', 'Waiting for review.',
					'pending', NULL, NULL, '2026-05-04T00:00:00.000Z'
				)`,
			);

			const response = await handlePublicApi(
				publicRequest("/api/posts/commented-post"),
				envWithDb(db.asD1()),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual(
				expect.objectContaining({
					comments: [
						{
							id: "comment-approved",
							nickname: "Ada",
							body: "A thoughtful note.",
							replyBody: "Thanks for reading.",
							replyCreatedAt: "2026-05-04T00:00:00.000Z",
							createdAt: "2026-05-03T00:00:00.000Z",
						},
					],
				}),
			);
		} finally {
			db.close();
		}
	});

	it("keeps existing comments visible but blocks new comments when site comments are disabled", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ id: "post-1", slug: "commented-post" }));
			db.insertContent("post-1", "# Commented");
			db.insertComment("post-1");
			db.exec(
				`INSERT INTO settings (key, value, encrypted, updated_at)
				 VALUES (
					'commentsGlobalEnabled', 'false', 0,
					'2026-05-20T00:00:00.000Z'
				 )`,
			);

			const detail = await handlePublicApi(
				publicRequest("/api/posts/commented-post"),
				envWithDb(db.asD1()),
			);
			const create = await handlePublicApi(
				new Request("https://example.test/api/posts/commented-post/comments", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						body: "Nope",
						turnstileToken: "turnstile-token",
					}),
				}),
				envWithDb(db.asD1()),
			);

			expect(detail.status).toBe(200);
			await expect(detail.json()).resolves.toEqual(
				expect.objectContaining({
					commentsEnabled: false,
					comments: [
						{
							id: "comment-1",
							nickname: "Ada",
							body: "A small hello.",
							createdAt: "2026-05-03T00:00:00.000Z",
						},
					],
				}),
			);
			expect(create.status).toBe(403);
			await expect(create.json()).resolves.toEqual({
				error: {
					code: "FORBIDDEN",
					message: "Comments are disabled for this site",
				},
			});
		} finally {
			db.close();
		}
	});

	it("creates comments with anonymous fallback after Turnstile validation", async () => {
		const db = new SqliteD1Database();
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ success: true }), {
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		try {
			db.insertPost(postRow({ id: "post-1", slug: "commented-post" }));
			db.insertContent("post-1", "# Commented");

			const response = await handlePublicApi(
				new Request("https://example.test/api/posts/commented-post/comments", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"cf-connecting-ip": "203.0.113.10",
					},
					body: JSON.stringify({
						nickname: "",
						body: "This is the submitted comment.",
						turnstileToken: "turnstile-token",
					}),
				}),
				envWithTurnstile(db.asD1()),
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				comment: expect.objectContaining({
					nickname: "Anonymous",
					body: "This is the submitted comment.",
				}),
			});
			expect(fetchMock).toHaveBeenCalledWith(
				"https://turnstile.test/siteverify",
				expect.objectContaining({
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						secret: "test-secret-key",
						response: "turnstile-token",
						remoteip: "203.0.113.10",
					}),
				}),
			);
		} finally {
			db.close();
		}
	});

	it("creates pending comments when moderation is enabled", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ id: "post-1", slug: "commented-post" }));
			db.insertContent("post-1", "# Commented");
			db.exec(
				`INSERT INTO settings (key, value, encrypted, updated_at)
				 VALUES (
					'commentsModerationEnabled', 'true', 0,
					'2026-05-20T00:00:00.000Z'
				 )`,
			);

			const create = await handlePublicApi(
				new Request("https://example.test/api/posts/commented-post/comments", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						nickname: "Ada",
						body: "Please review this.",
						turnstileToken: "turnstile-token",
					}),
				}),
				envWithDb(db.asD1()),
			);
			const detail = await handlePublicApi(
				publicRequest("/api/posts/commented-post"),
				envWithDb(db.asD1()),
			);

			expect(create.status).toBe(200);
			await expect(create.json()).resolves.toEqual({
				pending: true,
				comment: expect.objectContaining({
					nickname: "Ada",
					body: "Please review this.",
				}),
			});
			expect(detail.status).toBe(200);
			await expect(detail.json()).resolves.toEqual(
				expect.objectContaining({
					comments: [],
				}),
			);
		} finally {
			db.close();
		}
	});

	it("rate limits rapid comment bursts from the same client", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ id: "post-1", slug: "commented-post" }));
			db.insertContent("post-1", "# Commented");

			const submit = (index: number) =>
				handlePublicApi(
					new Request("https://example.test/api/posts/commented-post/comments", {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"cf-connecting-ip": "203.0.113.20",
							"user-agent": "vitest",
						},
						body: JSON.stringify({
							body: `Fast comment ${index}`,
							turnstileToken: "turnstile-token",
						}),
					}),
					envWithDb(db.asD1()),
				);

			const first = await submit(1);
			const second = await submit(2);
			const third = await submit(3);
			const fourth = await submit(4);

			expect(first.status).toBe(200);
			expect(second.status).toBe(200);
			expect(third.status).toBe(200);
			expect(fourth.status).toBe(429);
			expect(Number(fourth.headers.get("retry-after"))).toBeGreaterThan(0);
			await expect(fourth.json()).resolves.toEqual({
				error: {
					code: "RATE_LIMITED",
					message: "Too many comments. Please wait before posting again.",
				},
			});
		} finally {
			db.close();
		}
	});

	it("rate limits duplicate comments from the same client", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ id: "post-1", slug: "commented-post" }));
			db.insertContent("post-1", "# Commented");

			const submit = () =>
				handlePublicApi(
					new Request("https://example.test/api/posts/commented-post/comments", {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"cf-connecting-ip": "203.0.113.21",
							"user-agent": "vitest",
						},
						body: JSON.stringify({
							nickname: "Ada",
							body: "This is the same note.",
							turnstileToken: "turnstile-token",
						}),
					}),
					envWithDb(db.asD1()),
				);

			const first = await submit();
			const second = await submit();

			expect(first.status).toBe(200);
			expect(second.status).toBe(429);
			await expect(second.json()).resolves.toEqual({
				error: {
					code: "RATE_LIMITED",
					message: "Too many comments. Please wait before posting again.",
				},
			});
		} finally {
			db.close();
		}
	});

	it("blocks comments when post comments are disabled", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					slug: "quiet-post",
					comments_enabled: 0,
				}),
			);
			db.insertContent("post-1", "# Quiet");

			const response = await handlePublicApi(
				new Request("https://example.test/api/posts/quiet-post/comments", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						body: "Nope",
						turnstileToken: "turnstile-token",
					}),
				}),
				envWithDb(db.asD1()),
			);

			expect(response.status).toBe(403);
			await expect(response.json()).resolves.toEqual({
				error: {
					code: "FORBIDDEN",
					message: "Comments are disabled for this post",
				},
			});
		} finally {
			db.close();
		}
	});

	it("issues a Turnstile access cookie after challenge validation", async () => {
		const db = new SqliteD1Database();
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ success: true }), {
				headers: { "content-type": "application/json" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		try {
			const statusResponse = await handlePublicApi(
				publicRequest("/api/turnstile/access"),
				envWithTurnstile(db.asD1()),
			);
			const protectedResponse = await handlePublicApi(
				publicRequest("/api/posts?page=1&limit=1"),
				envWithTurnstile(db.asD1()),
			);
			const verifyResponse = await handlePublicApi(
				new Request("https://example.test/api/turnstile/access", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ turnstileToken: "access-token" }),
				}),
				envWithTurnstile(db.asD1()),
			);

			expect(statusResponse.status).toBe(200);
			await expect(statusResponse.json()).resolves.toEqual({
				enabled: true,
				verified: false,
				siteKey: "test-site-key",
			});
			expect(protectedResponse.status).toBe(403);
			expect(verifyResponse.status).toBe(200);
			expect(verifyResponse.headers.get("set-cookie")).toContain(
				"turnstile_access=",
			);
			await expect(verifyResponse.json()).resolves.toEqual({
				enabled: true,
				verified: true,
				siteKey: "test-site-key",
			});
		} finally {
			db.close();
		}
	});

	it("returns a locked marker and unlocks post detail with the configured password", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-locked",
					notion_page_id: "notion-locked",
					slug: "locked-post",
					title: "Locked post",
				}),
			);
			db.insertContent("post-locked", "# Locked body");
			db.exec(
				`UPDATE posts
				 SET locked = 1,
					 lock_password_encrypted = '${await encryptString("open-sesame", rootKey)}'
				 WHERE id = 'post-locked'`,
			);

			const lockedResponse = await handlePublicApi(
				publicRequest("/api/posts/locked-post"),
				envWithDb(db.asD1()),
			);
			const badUnlockResponse = await handlePublicApi(
				new Request("https://example.test/api/posts/locked-post/unlock", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ password: "wrong" }),
				}),
				envWithDb(db.asD1()),
			);
			const unlockResponse = await handlePublicApi(
				new Request("https://example.test/api/posts/locked-post/unlock", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ password: "open-sesame" }),
				}),
				envWithDb(db.asD1()),
			);

			expect(lockedResponse.status).toBe(200);
			expect(lockedResponse.headers.get("cache-control")).toBe(
				"public, no-cache",
			);
			await expect(lockedResponse.json()).resolves.toEqual({
				locked: true,
				slug: "locked-post",
				title: "Locked post",
			});
			expect(badUnlockResponse.status).toBe(401);
			expect(unlockResponse.status).toBe(200);
			await expect(unlockResponse.json()).resolves.toEqual(
				expect.objectContaining({
					slug: "locked-post",
					markdown: "# Locked body",
				}),
			);
		} finally {
			db.close();
		}
	});

	it("treats manually hidden posts as unavailable by slug", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-hidden",
					notion_page_id: "notion-hidden",
					slug: "manual-hidden-post",
					title: "Manual hidden post",
				}),
			);
			db.insertContent("post-hidden", "# Hidden body");
			db.exec("UPDATE posts SET manual_visibility = 'hidden' WHERE id = 'post-hidden'");

			const response = await handlePublicApi(
				publicRequest("/api/posts/manual-hidden-post"),
				envWithDb(db.asD1()),
			);

			expect(response.status).toBe(404);
		} finally {
			db.close();
		}
	});

	it("returns structured 404 when post markdown content is missing", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("JOIN post_content")) {
				return [];
			}
			if (sql.includes("WHERE slug = ?")) {
				return [postRow()];
			}
			return [];
		});

		const response = await handlePublicApi(
			publicRequest("/api/posts/published-post"),
			envWithDb(fakeDb.asD1()),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: { code: "NOT_FOUND", message: "Post content not found" },
		});
	});

	it("returns structured 404 for missing posts and unknown routes", async () => {
		const fakeDb = new FakeD1Database(() => []);

		const missingPost = await handlePublicApi(
			publicRequest("/api/posts/missing"),
			envWithDb(fakeDb.asD1()),
		);
		const unknownRoute = await handlePublicApi(
			publicRequest("/api/does-not-exist"),
			envWithDb(fakeDb.asD1()),
		);

		expect(missingPost.status).toBe(404);
		await expect(missingPost.json()).resolves.toEqual({
			error: { code: "NOT_FOUND", message: "Post not found" },
		});
		expect(unknownRoute.status).toBe(404);
		await expect(unknownRoute.json()).resolves.toEqual({
			error: { code: "NOT_FOUND", message: "Route not found" },
		});
	});

	it("returns public tag counts", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ id: "post-1", notion_page_id: "notion-1" }));
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "second-post",
				}),
			);
			db.insertTag("post-1", "Life", 0);
			db.insertTag("post-2", "Life", 0);
			db.insertTag("post-2", "Notes", 1);

			const response = await handlePublicApi(
				publicRequest("/api/tags"),
				envWithDb(db.asD1()),
			);

			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe(
				"public, no-cache",
			);
			await expect(response.json()).resolves.toEqual({
				items: [
					{ name: "Life", count: 2 },
					{ name: "Notes", count: 1 },
				],
			});
		} finally {
			db.close();
		}
	});

	it("returns public category counts", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ id: "post-1", notion_page_id: "notion-1", category: "Essay" }));
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "note-post",
					category: "Note",
				}),
			);

			const response = await handlePublicApi(
				publicRequest("/api/categories"),
				envWithDb(db.asD1()),
			);

			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe(
				"public, no-cache",
			);
			await expect(response.json()).resolves.toEqual({
				items: [
					{ name: "Essay", count: 1 },
					{ name: "Note", count: 1 },
				],
			});
		} finally {
			db.close();
		}
	});

	it("searches published posts and content with predictable empty query handling", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("post_content")) {
				return [
					postRow({
						slug: "api-post",
						title: "API post",
					}),
				];
			}
			return [];
		});

		const searchResponse = await handlePublicApi(
			publicRequest("/api/search?q=api"),
			envWithDb(fakeDb.asD1()),
		);
		const emptyResponse = await handlePublicApi(
			publicRequest("/api/search?q=   "),
			envWithDb(fakeDb.asD1()),
		);

		expect(searchResponse.status).toBe(200);
		expect(searchResponse.headers.get("cache-control")).toBe(
			"public, no-cache",
		);
		await expect(searchResponse.json()).resolves.toEqual({
			items: [expect.objectContaining({ slug: "api-post", title: "API post" })],
			total: 1,
			q: "api",
		});
		expect(emptyResponse.status).toBe(200);
		expect(emptyResponse.headers.get("cache-control")).toBe(
			"public, no-cache",
		);
		await expect(emptyResponse.json()).resolves.toEqual({
			items: [],
			total: 0,
			q: "",
		});
	});

	it("routes public API requests through the worker app", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("COUNT(DISTINCT p.id)")) {
				return [{ total: 1 }];
			}
			if (sql.includes("SELECT DISTINCT")) {
				return [postRow({ slug: "from-worker" })];
			}
			return [];
		});

		const response = await worker.fetch(
			publicRequest("/api/posts") as WorkerRequest,
			envWithDb(fakeDb.asD1()),
			{} as ExecutionContext,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(
			expect.objectContaining({
				items: [expect.objectContaining({ slug: "from-worker" })],
			}),
		);
	});

	it("injects post sharing metadata while keeping posts noindex", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "quiet notes",
					title: "Quiet & Bright",
					excerpt: "Life <in> quiet moments.",
					cover_url: "https://assets.233.life/assets/cover.jpg",
				}),
			);

			const response = await worker.fetch(
				publicRequest("/post/quiet%20notes") as WorkerRequest,
				envWithDbAndAssets(db.asD1()),
				{} as ExecutionContext,
			);
			const html = await response.text();

			expect(response.status).toBe(200);
			expect(response.headers.get("x-robots-tag")).toBe(
				"noindex, nofollow, noarchive, nosnippet, noimageindex",
			);
			expect(html).toContain("<title>Quiet &amp; Bright | 233.life</title>");
			expect(html).toContain(
				'<meta property="og:title" content="Quiet &amp; Bright | 233.life" />',
			);
			expect(html).toContain(
				'<meta property="og:description" content="Life &lt;in&gt; quiet moments." />',
			);
			expect(html).toContain(
				'<meta property="og:image" content="https://assets.233.life/assets/cover.jpg" />',
			);
			expect(html).toContain(
				'<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex" />',
			);
		} finally {
			db.close();
		}
	});

	it("returns a sitemap XML document through the worker app", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "life post",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "hidden post",
					visibility: "hidden",
				}),
			);

			const response = await worker.fetch(
				publicRequest("/sitemap.xml") as WorkerRequest,
				envWithDb(db.asD1()),
				{} as ExecutionContext,
			);
			const xml = await response.text();

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe(
				"application/xml; charset=utf-8",
			);
			expect(xml).toContain("<loc>https://example.test/</loc>");
			expect(response.headers.get("x-robots-tag")).toBe(
				"noindex, nofollow, noarchive, nosnippet, noimageindex",
			);
			expect(xml).not.toContain("<loc>https://example.test/post/life%20post</loc>");
			expect(xml).not.toContain("hidden post");
		} finally {
			db.close();
		}
	});

	it("returns an RSS XML document through the worker app", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(
				postRow({
					id: "post-1",
					notion_page_id: "notion-1",
					slug: "life post",
				}),
			);
			db.insertPost(
				postRow({
					id: "post-2",
					notion_page_id: "notion-2",
					slug: "hidden post",
					visibility: "hidden",
				}),
			);
			db.exec(
				`INSERT INTO settings (key, value, encrypted, updated_at)
				 VALUES ('siteTitle', '233.life custom', 0, '2026-05-20T00:00:00.000Z')`,
			);

			const response = await worker.fetch(
				publicRequest("/rss.xml") as WorkerRequest,
				envWithDb(db.asD1()),
				{} as ExecutionContext,
			);
			const xml = await response.text();

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe(
				"application/rss+xml; charset=utf-8",
			);
			expect(response.headers.get("x-robots-tag")).toBe(
				"noindex, nofollow, noarchive, nosnippet, noimageindex",
			);
			expect(xml).toContain("<title>233.life custom</title>");
			expect(xml).toContain("<link>https://example.test/post/life%20post</link>");
			expect(xml).not.toContain("hidden post");
		} finally {
			db.close();
		}
	});

	it("returns a sitemap XML document from the public sitemap handler", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ slug: "direct sitemap" }));

			const response = await handleSitemap(
				publicRequest("/sitemap.xml"),
				envWithDb(db.asD1()),
			);
			const xml = await response.text();

			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe(
				"public, max-age=300",
			);
			expect(response.headers.get("x-robots-tag")).toBe(
				"noindex, nofollow, noarchive, nosnippet, noimageindex",
			);
			expect(xml).toContain("<loc>https://example.test/</loc>");
			expect(xml).not.toContain(
				"<loc>https://example.test/post/direct%20sitemap</loc>",
			);
		} finally {
			db.close();
		}
	});

	it("returns robots.txt for anti-index discovery", async () => {
		const response = await handleRobots(publicRequest("/robots.txt"));
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("public, max-age=300");
		expect(response.headers.get("x-robots-tag")).toBe(
			"noindex, nofollow, noarchive, nosnippet, noimageindex",
		);
		expect(body).toContain("Allow: /");
		expect(body).toContain("Disallow: /admin");
		expect(body).not.toContain("Sitemap:");
	});

	it("returns an RSS XML document from the public RSS handler", async () => {
		const db = new SqliteD1Database();
		try {
			db.insertPost(postRow({ slug: "direct rss" }));

			const response = await handleRss(
				publicRequest("/rss.xml"),
				envWithDb(db.asD1()),
			);
			const xml = await response.text();

			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe(
				"public, max-age=300",
			);
			expect(response.headers.get("x-robots-tag")).toBe(
				"noindex, nofollow, noarchive, nosnippet, noimageindex",
			);
			expect(xml).toContain(
				"<link>https://example.test/post/direct%20rss</link>",
			);
		} finally {
			db.close();
		}
	});

	it("returns structured 404 for unknown API routes through the worker app", async () => {
		const fakeDb = new FakeD1Database(() => []);

		const response = await worker.fetch(
			publicRequest("/api/does-not-exist") as WorkerRequest,
			envWithDb(fakeDb.asD1()),
			{} as ExecutionContext,
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: { code: "NOT_FOUND", message: "Route not found" },
		});
	});
});
