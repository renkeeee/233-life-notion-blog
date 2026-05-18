import { describe, expect, it } from "vitest";
import worker from "../workers/app";
import {
	handlePublicApi,
	listPostsResponse,
	postDetailResponse,
	type PublicPostRecord,
} from "../workers/api/public";
import { PostContentRepository, PostsRepository } from "../workers/db/d1";
import type { AppEnv } from "../workers/types";

type WorkerRequest = Parameters<NonNullable<typeof worker.fetch>>[0];

type SqlCall = {
	sql: string;
	values: unknown[];
};

type FakeRows = Record<string, unknown>[];

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

const publishedPost: PublicPostRecord = {
	id: "post-1",
	slug: "published-post",
	title: "Published post",
	summary: "Visible summary",
	coverUrl: "https://cdn.example.com/cover.jpg",
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
		CONFIG_ENCRYPTION_KEY: "test-encryption-key",
	};
}

function postRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id: "post-1",
		notion_page_id: "notion-1",
		slug: "published-post",
		title: "Published post",
		summary: "Visible summary",
		cover_url: "https://cdn.example.com/cover.jpg",
		tags_json: JSON.stringify(["Life", "Notes"]),
		status: "ready",
		visibility: "published",
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
	it("filters hidden and archived posts from list responses", () => {
		const response = listPostsResponse(
			[
				publishedPost,
				{ ...publishedPost, id: "post-2", visibility: "hidden" },
				{ ...publishedPost, id: "post-3", visibility: "archived" },
			],
			{ page: 1, limit: 10 },
		);

		expect(response).toEqual({
			items: [
				expect.objectContaining({
					id: "post-1",
					slug: "published-post",
					tags: ["Life", "Notes"],
				}),
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
			summary: "Visible summary",
			coverUrl: "https://cdn.example.com/cover.jpg",
			tags: ["Life", "Notes"],
			publishedAt: "2026-05-01T00:00:00.000Z",
			updatedAt: "2026-05-02T00:00:00.000Z",
			markdown: "# Hello",
		});
	});
});

describe("PostsRepository", () => {
	it("maps snake_case rows to public records and sanitizes tags_json", async () => {
		const fakeDb = new FakeD1Database(() => [
			postRow({
				tags_json: JSON.stringify(["Life", 42, "Notes", "", null]),
			}),
			postRow({
				id: "post-2",
				slug: "bad-tags",
				tags_json: "{bad json",
			}),
		]);
		const repository = new PostsRepository(fakeDb.asD1());

		await expect(repository.listPublished()).resolves.toEqual([
			expect.objectContaining({
				id: "post-1",
				coverUrl: "https://cdn.example.com/cover.jpg",
				publishedAt: "2026-05-01T00:00:00.000Z",
				tags: ["Life", "Notes"],
				updatedAt: "2026-05-02T00:00:00.000Z",
			}),
			expect.objectContaining({
				id: "post-2",
				slug: "bad-tags",
				tags: [],
			}),
		]);
	});

	it("uses published visibility filters and bound search patterns", async () => {
		const fakeDb = new FakeD1Database(() => []);
		const repository = new PostsRepository(fakeDb.asD1());

		await repository.searchPublished("notion api");

		expect(fakeDb.calls[0]?.sql).toContain("visibility = 'published'");
		expect(fakeDb.calls[0]?.sql).toContain("post_content");
		expect(fakeDb.calls[0]?.values).toEqual([
			"%notion api%",
			"%notion api%",
			"%notion api%",
			"%notion api%",
		]);
	});

	it("returns published tag counts", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("SELECT id")) {
				return [
					postRow({ tags_json: JSON.stringify(["Life", "Notes"]) }),
					postRow({
						id: "post-2",
						tags_json: JSON.stringify(["Life", ""]),
					}),
					postRow({
						id: "post-3",
						tags_json: "{bad json",
					}),
				];
			}
			return [];
		});
		const repository = new PostsRepository(fakeDb.asD1());

		await expect(repository.tagCounts()).resolves.toEqual([
			{ tag: "Life", count: 2 },
			{ tag: "Notes", count: 1 },
		]);
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
	it("returns health JSON", async () => {
		const fakeDb = new FakeD1Database(() => []);

		const response = await handlePublicApi(
			publicRequest("/api/health"),
			envWithDb(fakeDb.asD1()),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("lists posts with pagination and tag filtering", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("SELECT id")) {
				return [
					postRow({
						id: "post-1",
						slug: "life-post",
						tags_json: JSON.stringify(["Life"]),
					}),
					postRow({
						id: "post-2",
						slug: "tech-post",
						tags_json: JSON.stringify(["Tech"]),
					}),
				];
			}
			return [];
		});

		const response = await handlePublicApi(
			publicRequest("/api/posts?page=1&limit=1&tag=Life"),
			envWithDb(fakeDb.asD1()),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			items: [expect.objectContaining({ slug: "life-post", tags: ["Life"] })],
			total: 1,
			page: 1,
			limit: 1,
		});
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
			if (sql.includes("SELECT id")) {
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
			if (sql.includes("WHERE slug = ?")) {
				return [postRow({ slug: "hello world" })];
			}
			if (sql.includes("FROM post_content")) {
				return [{ markdown: "# Hello world" }];
			}
			return [];
		});

		const response = await handlePublicApi(
			publicRequest("/api/posts/hello%20world"),
			envWithDb(fakeDb.asD1()),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(
			expect.objectContaining({
				slug: "hello world",
				markdown: "# Hello world",
			}),
		);
	});

	it("returns structured 404 when post markdown content is missing", async () => {
		const fakeDb = new FakeD1Database((sql) => {
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
			publicRequest("/api/nope"),
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

	it("returns tags with published counts", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("SELECT id")) {
				return [
					postRow({ tags_json: JSON.stringify(["Life", "Notes"]) }),
					postRow({
						id: "post-2",
						tags_json: JSON.stringify(["Life"]),
					}),
				];
			}
			return [];
		});

		const response = await handlePublicApi(
			publicRequest("/api/tags"),
			envWithDb(fakeDb.asD1()),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			items: [
				{ tag: "Life", count: 2 },
				{ tag: "Notes", count: 1 },
			],
		});
	});

	it("searches published posts and content with predictable empty query handling", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("post_content")) {
				return [
					postRow({
						slug: "api-post",
						title: "API post",
						tags_json: JSON.stringify(["Tech"]),
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
		await expect(searchResponse.json()).resolves.toEqual({
			items: [expect.objectContaining({ slug: "api-post", title: "API post" })],
			total: 1,
			q: "api",
		});
		expect(emptyResponse.status).toBe(200);
		await expect(emptyResponse.json()).resolves.toEqual({
			items: [],
			total: 0,
			q: "",
		});
	});

	it("routes public API requests through the worker app", async () => {
		const fakeDb = new FakeD1Database((sql) => {
			if (sql.includes("SELECT id")) {
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
});
