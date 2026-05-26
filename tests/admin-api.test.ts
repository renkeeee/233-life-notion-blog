import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { handleAdminApi, validateLoginBody } from "../workers/api/admin";
import { generateEncryptionKey } from "../workers/crypto";
import schemaSql from "../workers/db/schema.sql?raw";
import type { SettingRow } from "../workers/settings";
import type { AppEnv } from "../workers/types";

type SqlInputValue = string | number | bigint | null | Uint8Array;

function createFakeD1(): D1Database {
	const rows = new Map<string, SettingRow>();

	return {
		prepare() {
			return {
				bind(...values: unknown[]) {
					return {
						async first<T>() {
							return (rows.get(String(values[0])) ?? null) as T | null;
						},
						async run() {
							const [key, value, encrypted, updatedAt] = values;
							rows.set(String(key), {
								key: String(key),
								value: String(value),
								encrypted: encrypted as 0 | 1,
								updated_at: String(updatedAt),
							});
						},
					};
				},
				async all<T>() {
					return { results: Array.from(rows.values()) as T[], success: true };
				},
			};
		},
	} as unknown as D1Database;
}

function testEnv(): AppEnv {
	return {
		DB: createFakeD1(),
		BLOG_ASSETS: {} as R2Bucket,
		CONFIG_ENCRYPTION_KEY: generateEncryptionKey(),
	};
}

function adminRequest(
	pathname: string,
	init: RequestInit = {},
): Request {
	return new Request(`https://example.test${pathname}`, init);
}

function csrfHeaders(token: string): HeadersInit {
	return { "content-type": "application/json", "x-csrf-token": token };
}

async function login(env: AppEnv): Promise<{
	cookie: string;
	csrfToken: string;
}> {
	const response = await handleAdminApi(
		adminRequest("/api/admin/login", {
			body: JSON.stringify({ password: "123456" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		env,
	);
	const cookie = response.headers.get("set-cookie") ?? "";
	const body = (await response.json()) as { csrfToken: string };

	return {
		cookie: cookie.split(";")[0] ?? "",
		csrfToken: body.csrfToken,
	};
}

async function usableLogin(env: AppEnv): Promise<{
	cookie: string;
	csrfToken: string;
}> {
	const session = await login(env);
	const response = await handleAdminApi(
		adminRequest("/api/admin/password", {
			body: JSON.stringify({
				currentPassword: "123456",
				newPassword: "changed-password",
			}),
			headers: {
				...csrfHeaders(session.csrfToken),
				cookie: session.cookie,
			},
			method: "POST",
		}),
		env,
	);

	expect(response.status).toBe(200);
	return session;
}

class SqliteD1PreparedStatement {
	private values: unknown[] = [];

	constructor(private readonly statement: ReturnType<DatabaseSync["prepare"]>) {}

	bind(...values: unknown[]): D1PreparedStatement {
		this.values = values;
		return this as unknown as D1PreparedStatement;
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		return (
			this.statement.get(...(this.values as SqlInputValue[])) ?? null
		) as T | null;
	}

	async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
		return {
			results: this.statement.all(...(this.values as SqlInputValue[])) as T[],
			success: true,
			meta: {},
		} as D1Result<T>;
	}

	async run(): Promise<D1Result> {
		this.statement.run(...(this.values as SqlInputValue[]));
		return { results: [], success: true, meta: {} } as unknown as D1Result;
	}
}

type FakeR2Bucket = R2Bucket & {
	heads: string[];
	failPut: boolean;
	puts: Array<{
		key: string;
		body: ArrayBuffer;
		options?: { httpMetadata?: Record<string, string> };
	}>;
};

function fakeR2Bucket(): FakeR2Bucket {
	const bucket = {
		failPut: false,
		heads: [] as string[],
		puts: [] as FakeR2Bucket["puts"],
		async head(key: string) {
			bucket.heads.push(key);
			return null;
		},
		async put(
			key: string,
			body: ArrayBuffer,
			options?: { httpMetadata?: Record<string, string> },
		) {
			if (bucket.failPut) {
				throw new Error("R2 put failed");
			}

			bucket.puts.push({ key, body, options });
			return null;
		},
	};

	return bucket as unknown as FakeR2Bucket;
}

class SqliteAdminD1 {
	private readonly db = new DatabaseSync(":memory:");
	batchCallCount = 0;

	constructor() {
		this.db.exec("PRAGMA foreign_keys = ON;");
		this.db.exec(schemaSql);
	}

	prepare(sql: string): D1PreparedStatement {
		return new SqliteD1PreparedStatement(
			this.db.prepare(sql),
		) as unknown as D1PreparedStatement;
	}

	async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
		this.batchCallCount += 1;
		this.db.exec("BEGIN");
		try {
			const results: D1Result[] = [];
			for (const statement of statements) {
				results.push(await statement.run());
			}
			this.db.exec("COMMIT");
			return results;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	rows<T = Record<string, unknown>>(
		sql: string,
		...values: SqlInputValue[]
	): T[] {
		return this.db.prepare(sql).all(...values) as T[];
	}

	exec(sql: string): void {
		this.db.exec(sql);
	}

	asD1(): D1Database {
		return this as unknown as D1Database;
	}
}

function sqliteAdminEnv(): {
	bucket: FakeR2Bucket;
	db: SqliteAdminD1;
	env: AppEnv;
} {
	const db = new SqliteAdminD1();
	const bucket = fakeR2Bucket();
	const now = "2026-05-26T00:00:00.000Z";
	db.prepare(
		`INSERT INTO settings (key, value, encrypted, updated_at)
		 VALUES (?, ?, ?, ?)`,
	)
		.bind("cdnBaseUrl", "https://assets.233.life", 0, now)
		.run();

	return {
		bucket,
		db,
		env: {
			DB: db.asD1(),
			BLOG_ASSETS: bucket,
			CONFIG_ENCRYPTION_KEY: generateEncryptionKey(),
		},
	};
}

function sqliteRows<T = Record<string, unknown>>(
	db: SqliteAdminD1,
	sql: string,
): T[] {
	return db.rows<T>(sql);
}

async function createDraftThroughApi(
	env: AppEnv,
	session: { cookie: string; csrfToken: string },
	title: string,
): Promise<Record<string, unknown>> {
	const response = await handleAdminApi(
		adminRequest("/api/admin/local-posts", {
			body: JSON.stringify({ title }),
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "POST",
		}),
		env,
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as { draft: Record<string, unknown> };
	return body.draft;
}

async function updateDraftThroughApi(
	env: AppEnv,
	session: { cookie: string; csrfToken: string },
	draftId: unknown,
	body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const response = await handleAdminApi(
		adminRequest(`/api/admin/local-posts/${String(draftId)}`, {
			body: JSON.stringify(body),
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "PUT",
		}),
		env,
	);
	expect(response.status).toBe(200);
	const responseBody = (await response.json()) as {
		draft: Record<string, unknown>;
	};
	return responseBody.draft;
}

function insertPublicPost(
	db: SqliteAdminD1,
	input: {
		id: string;
		slug: string;
		title: string;
		sourceType?: "notion" | "local";
		sourceId?: string | null;
		visibility?: "published" | "hidden" | "archived";
	},
): void {
	const now = "2026-05-26T00:00:00.000Z";
	db.prepare(
		`INSERT INTO posts (
			id, notion_page_id, slug, title, excerpt, cover_url, category,
			status, visibility, published_at, notion_last_edited_time,
			content_hash, last_sync_error, created_at, updated_at, comments_enabled,
			source_type, source_id
		)
		VALUES (?, ?, ?, ?, '', NULL, NULL, 'published', ?, ?, ?, NULL, NULL, ?, ?, 1, ?, ?)`,
	)
		.bind(
			input.id,
			input.sourceType === "local"
				? `local:${input.sourceId ?? input.id}`
				: `notion-${input.id}`,
			input.slug,
			input.title,
			input.visibility ?? "published",
			now,
			now,
			now,
			now,
			input.sourceType ?? "notion",
			input.sourceId ?? null,
		)
		.run();
}

async function insertPublishedLocalPostWithContent(
	db: SqliteAdminD1,
	input: {
		postId: string;
		sourceId: string;
		slug: string;
		title: string;
		markdown: string;
	},
): Promise<void> {
	const now = "2026-05-26T00:00:00.000Z";
	insertPublicPost(db, {
		id: input.postId,
		slug: input.slug,
		sourceId: input.sourceId,
		sourceType: "local",
		title: input.title,
	});
	await db
		.prepare(
			`INSERT INTO post_content (
				post_id, markdown, block_snapshot_hash, content_hash,
				resource_refs_json, created_at, updated_at
			)
			VALUES (?, ?, 'local:test-content-hash', 'test-content-hash', '[]', ?, ?)`,
		)
		.bind(input.postId, input.markdown, now, now)
		.run();
}

async function createAndPublishLocalPost(
	env: AppEnv,
	session: { cookie: string; csrfToken: string },
): Promise<Record<string, unknown>> {
	const draft = await createDraftThroughApi(env, session, "Local hello");
	await updateDraftThroughApi(env, session, draft.id, {
		title: "Local hello",
		slug: "local-hello",
		excerpt: "A local excerpt",
		markdown: "Hello from **local** writing.",
		category: "Life",
		tags: ["local", "writing"],
		commentsEnabled: true,
	});

	const response = await handleAdminApi(
		adminRequest(`/api/admin/local-posts/${String(draft.id)}/publish`, {
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "POST",
		}),
		env,
	);
	expect(response.status).toBe(200);
	const body = (await response.json()) as { draft: Record<string, unknown> };
	return body.draft;
}

describe("admin login validation", () => {
	it("accepts a non-empty string password", () => {
		expect(validateLoginBody({ password: "secret" })).toEqual({
			password: "secret",
		});
	});

	it.each([
		["missing", {}],
		["empty", { password: "" }],
		["non-string", { password: 123 }],
	])("rejects %s password", (_name, body) => {
		expect(() => validateLoginBody(body)).toThrow("Password is required");
	});

	it("rejects overlong passwords", () => {
		expect(() => validateLoginBody({ password: "a".repeat(1025) })).toThrow(
			"Password must be at most 1024 characters",
		);
	});
});

describe("admin API routes", () => {
	it("logs in without echoing password details", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/login", {
				body: JSON.stringify({ password: "123456" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			testEnv(),
		);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual({
			authenticated: true,
			csrfToken: expect.any(String),
			mustChangePassword: true,
		});
		expect(body).not.toHaveProperty("password");
		expect(body).not.toHaveProperty("passwordLength");
		expect(JSON.stringify(body)).not.toContain("123456");
	});

	it("returns the unauthenticated admin identity when no session exists", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/me", { method: "GET" }),
			testEnv(),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ authenticated: false });
	});

	it("returns the admin not found shape for unknown admin routes", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/nope", { method: "GET" }),
			testEnv(),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: { code: "NOT_FOUND", message: "Admin API route not found" },
		});
	});

	it("returns bad request JSON for invalid login JSON", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/login", {
				body: "{",
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			testEnv(),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: { code: "BAD_REQUEST", message: "Invalid request body" },
		});
	});

	it.each([
		["missing", {}],
		["empty", { password: "" }],
		["non-string", { password: 123 }],
	])("returns bad request JSON for %s login password", async (_name, body) => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/login", {
				body: JSON.stringify(body),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			testEnv(),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: { code: "BAD_REQUEST", message: "Password is required" },
		});
	});

	it("returns bad request JSON for overlong login passwords", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/login", {
				body: JSON.stringify({ password: "a".repeat(1025) }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			testEnv(),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "BAD_REQUEST",
				message: "Password must be at most 1024 characters",
			},
		});
	});

	it("creates and loads a local post draft", async () => {
		const { env } = sqliteAdminEnv();
		const session = await usableLogin(env);

		const created = await createDraftThroughApi(env, session, "Local Draft");
		const response = await handleAdminApi(
			adminRequest(`/api/admin/local-posts/${String(created.id)}`, {
				headers: { cookie: session.cookie },
				method: "GET",
			}),
			env,
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			draft: { id: string; title: string; status: string };
		};
		expect(body.draft).toMatchObject({
			id: created.id,
			title: "Local Draft",
			status: "draft",
		});
	});

	it("updates a local post draft without creating a public post", async () => {
		const { db, env } = sqliteAdminEnv();
		const session = await usableLogin(env);
		const created = await createDraftThroughApi(env, session, "Original Title");

		const response = await handleAdminApi(
			adminRequest(`/api/admin/local-posts/${String(created.id)}`, {
				body: JSON.stringify({
					title: "Updated Title",
					slug: "updated-title",
					excerpt: "A short excerpt",
					markdown: "# Updated",
					tags: ["local", "draft"],
					commentsEnabled: false,
				}),
				headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
				method: "PUT",
			}),
			env,
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			draft: { id: string; title: string; status: string };
		};
		expect(body.draft).toMatchObject({
			id: created.id,
			title: "Updated Title",
			status: "draft",
		});
		expect(sqliteRows(db, "SELECT * FROM posts")).toEqual([]);
	});

	it("publishes a local draft into public post tables", async () => {
		const { db, env } = sqliteAdminEnv();
		const session = await usableLogin(env);
		const draft = await createDraftThroughApi(env, session, "Local hello");
		await updateDraftThroughApi(env, session, draft.id, {
			title: "Local hello",
			slug: "local-hello",
			excerpt: "A local excerpt",
			markdown: "Hello from **local** writing.",
			category: "Life",
			tags: ["local", "writing"],
			commentsEnabled: true,
		});

		const response = await handleAdminApi(
			adminRequest(`/api/admin/local-posts/${String(draft.id)}/publish`, {
				headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			draft: { id: string; postId: string | null; status: string };
		};
		expect(body.draft).toMatchObject({
			id: draft.id,
			status: "published",
			postId: expect.any(String),
		});
		expect(db.batchCallCount).toBe(1);
		expect(
			sqliteRows(
				db,
				"SELECT source_type, source_id, notion_page_id, slug, title FROM posts",
			),
		).toEqual([
			expect.objectContaining({
				notion_page_id: `local:${String(draft.id)}`,
				source_id: draft.id,
				source_type: "local",
				slug: "local-hello",
				title: "Local hello",
			}),
		]);
		expect(
			sqliteRows(db, "SELECT tag FROM post_tags ORDER BY sort_order"),
		).toEqual([{ tag: "local" }, { tag: "writing" }]);
		expect(
			sqliteRows(
				db,
				"SELECT markdown, block_snapshot_hash, content_hash FROM post_content",
			),
		).toEqual([
			{
				block_snapshot_hash: expect.stringMatching(/^local:/),
				content_hash: expect.any(String),
				markdown: "Hello from **local** writing.",
			},
		]);
	});

	it("normalizes legacy posts with null source type to notion in the admin list", async () => {
		const { db, env } = sqliteAdminEnv();
		const session = await usableLogin(env);
		db.exec("ALTER TABLE posts RENAME TO posts_strict");
		db.exec(
			`CREATE TABLE posts (
				id TEXT PRIMARY KEY,
				notion_page_id TEXT NOT NULL UNIQUE,
				slug TEXT NOT NULL UNIQUE,
				title TEXT NOT NULL,
				cover_url TEXT,
				status TEXT NOT NULL,
				visibility TEXT NOT NULL CHECK (visibility IN ('published', 'hidden', 'archived')),
				published_at TEXT,
				notion_last_edited_time TEXT NOT NULL,
				content_hash TEXT,
				last_sync_error TEXT,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				excerpt TEXT NOT NULL DEFAULT '',
				category TEXT,
				manual_visibility TEXT NOT NULL DEFAULT 'visible' CHECK (manual_visibility IN ('visible', 'hidden')),
				locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
				lock_password_encrypted TEXT,
				comments_enabled INTEGER NOT NULL DEFAULT 1 CHECK (comments_enabled IN (0, 1)),
				source_type TEXT CHECK (source_type IN ('notion', 'local')),
				source_id TEXT
			)`,
		);
		db.prepare(
			`INSERT INTO posts (
				id, notion_page_id, slug, title, cover_url, status, visibility,
				published_at, notion_last_edited_time, content_hash,
				last_sync_error, created_at, updated_at, source_type, source_id
			)
			VALUES (
				'legacy-post', 'notion-page-legacy', 'legacy-post', 'Legacy Post',
				NULL, 'Published', 'published', '2026-05-20T00:00:00.000Z',
				'2026-05-20T01:00:00.000Z', 'content-hash', NULL,
				'2026-05-20T00:00:00.000Z', '2026-05-20T01:00:00.000Z',
				NULL, NULL
			)`,
		).run();

		const response = await handleAdminApi(
			adminRequest("/api/admin/posts", {
				headers: { cookie: session.cookie },
				method: "GET",
			}),
			env,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			items: [
				expect.objectContaining({
					id: "legacy-post",
					sourceType: "notion",
					sourceId: null,
				}),
			],
		});
	});

	it("rejects resyncing a local post", async () => {
		const { db, env } = sqliteAdminEnv();
		const session = await usableLogin(env);
		insertPublicPost(db, {
			id: "local-post",
			slug: "local-post",
			sourceId: "local-post",
			sourceType: "local",
			title: "Local Post",
		});

		const response = await handleAdminApi(
			adminRequest("/api/admin/posts/local-post/resync", {
				body: JSON.stringify({}),
				headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
				method: "POST",
			}),
			env,
			{
				runSync: async () => {
					throw new Error("Local posts should not invoke Notion sync");
				},
			},
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "BAD_REQUEST",
				message: "Local posts cannot be resynced",
			},
		});
	});

	it("uploads local post images to R2", async () => {
		const { bucket, env } = sqliteAdminEnv();
		const session = await usableLogin(env);

		const response = await handleAdminApi(
			adminRequest("/api/admin/uploads", {
				body: new Uint8Array([1, 2, 3, 4]),
				headers: {
					"content-type": "image/png",
					"x-csrf-token": session.csrfToken,
					cookie: session.cookie,
				},
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			asset: {
				url: string;
				r2Key: string;
				contentHash: string;
				contentType: string;
				size: number;
			};
		};
		expect(body.asset).toMatchObject({
			url: expect.stringContaining("https://assets.233.life/assets/"),
			r2Key: expect.stringContaining("assets/"),
			contentType: "image/png",
			size: 4,
		});
		expect(bucket.heads).toEqual([body.asset.r2Key]);
		expect(bucket.puts).toEqual([
			expect.objectContaining({
				key: body.asset.r2Key,
			}),
		]);
	});

	it("returns R2_UPLOAD_FAILED with status 500 when local image upload fails", async () => {
		const { bucket, env } = sqliteAdminEnv();
		bucket.failPut = true;
		const session = await usableLogin(env);

		const response = await handleAdminApi(
			adminRequest("/api/admin/uploads", {
				body: new Uint8Array([1, 2, 3, 4]),
				headers: {
					"content-type": "image/png",
					"x-csrf-token": session.csrfToken,
					cookie: session.cookie,
				},
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: { code: "R2_UPLOAD_FAILED", message: "Asset upload failed" },
		});
	});

	it("publishes markdown images into post media and album items", async () => {
		const { db, env } = sqliteAdminEnv();
		const session = await usableLogin(env);
		const draft = await createDraftThroughApi(env, session, "Local images");
		await updateDraftThroughApi(env, session, draft.id, {
			title: "Local images",
			slug: "local-images",
			markdown: [
				"Intro",
				"![First](https://assets.233.life/assets/aa/first.png)",
				"![Second](<https://assets.233.life/assets/bb/second.webp>)",
			].join("\n\n"),
			commentsEnabled: true,
			publishedAt: "2026-05-20",
		});

		const response = await handleAdminApi(
			adminRequest(`/api/admin/local-posts/${String(draft.id)}/publish`, {
				headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(200);
		const media = sqliteRows<{
			id: string;
			kind: string;
			url: string;
			sort_order: number;
			content_hash: string | null;
		}>(
			db,
			"SELECT id, kind, url, sort_order, content_hash FROM post_media ORDER BY sort_order",
		);
		const albumItems = sqliteRows<{
			source_id: string;
			post_id: string;
			kind: string;
			url: string;
			thumbnail_url: string | null;
			large_url: string | null;
			title: string;
			visibility: string;
			featured: number;
			sort_order: number;
			source_content_hash: string | null;
		}>(
			db,
			`SELECT
				source_id, post_id, kind, url, thumbnail_url, large_url, title,
				visibility, featured, sort_order, source_content_hash
			 FROM album_items
			 ORDER BY sort_order`,
		);

		expect(media).toEqual([
			expect.objectContaining({
				kind: "image",
				url: "https://assets.233.life/assets/aa/first.png",
				sort_order: 0,
				content_hash: expect.any(String),
			}),
			expect.objectContaining({
				kind: "image",
				url: "https://assets.233.life/assets/bb/second.webp",
				sort_order: 1,
				content_hash: expect.any(String),
			}),
		]);
		expect(albumItems).toEqual([
			expect.objectContaining({
				source_id: media[0].id,
				kind: "image",
				url: media[0].url,
				thumbnail_url:
					"https://assets.233.life/cdn-cgi/image/width=440,quality=82,format=auto/assets/aa/first.png",
				large_url: media[0].url,
				title: "Local images",
				visibility: "visible",
				featured: 0,
				sort_order: 0,
				source_content_hash: media[0].content_hash,
			}),
			expect.objectContaining({
				source_id: media[1].id,
				thumbnail_url:
					"https://assets.233.life/cdn-cgi/image/width=440,quality=82,format=auto/assets/bb/second.webp",
				sort_order: 1,
				source_content_hash: media[1].content_hash,
			}),
		]);
	});

	it("preserves local image album fields when a different image is inserted before it", async () => {
		const { db, env } = sqliteAdminEnv();
		const session = await usableLogin(env);
		const draft = await createDraftThroughApi(env, session, "Local reorder");
		const imageA = "https://assets.233.life/assets/aa/a.png";
		const imageB = "https://assets.233.life/assets/bb/b.png";
		const imageNew = "https://assets.233.life/assets/cc/new.png";

		await updateDraftThroughApi(env, session, draft.id, {
			title: "Local reorder",
			slug: "local-reorder",
			markdown: [`![A](${imageA})`, `![B](${imageB})`].join("\n\n"),
			commentsEnabled: true,
			publishedAt: "2026-05-20",
		});

		const firstPublish = await handleAdminApi(
			adminRequest(`/api/admin/local-posts/${String(draft.id)}/publish`, {
				headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
				method: "POST",
			}),
			env,
		);
		expect(firstPublish.status).toBe(200);

		const originalA = db.rows<{
			source_id: string;
			sort_order: number;
		}>(
			"SELECT source_id, sort_order FROM album_items WHERE url = ?",
			imageA,
		)[0];
		expect(originalA).toMatchObject({
			source_id: expect.any(String),
			sort_order: 0,
		});

		db.prepare(
			`UPDATE album_items
			 SET title = 'Manual A title',
				 visibility = 'hidden'
			 WHERE source_id = ?`,
		)
			.bind(originalA.source_id)
			.run();

		await updateDraftThroughApi(env, session, draft.id, {
			title: "Local reorder",
			slug: "local-reorder",
			markdown: [
				`![New](${imageNew})`,
				`![A](${imageA})`,
				`![B](${imageB})`,
			].join("\n\n"),
			commentsEnabled: true,
			publishedAt: "2026-05-20",
		});

		const secondPublish = await handleAdminApi(
			adminRequest(`/api/admin/local-posts/${String(draft.id)}/publish`, {
				headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
				method: "POST",
			}),
			env,
		);
		expect(secondPublish.status).toBe(200);

		const republishedA = db.rows<{
			source_id: string;
			title: string;
			visibility: string;
			sort_order: number;
		}>(
			`SELECT source_id, title, visibility, sort_order
			 FROM album_items
			 WHERE url = ?`,
			imageA,
		)[0];
		const orders = db.rows<{ url: string; sort_order: number }>(
			`SELECT url, sort_order
			 FROM album_items
			 WHERE url IN (?, ?, ?)
			 ORDER BY sort_order`,
			imageNew,
			imageA,
			imageB,
		);

		expect(republishedA).toEqual({
			source_id: originalA.source_id,
			title: "Manual A title",
			visibility: "hidden",
			sort_order: 1,
		});
		expect(orders).toEqual([
			{ url: imageNew, sort_order: 0 },
			{ url: imageA, sort_order: 1 },
			{ url: imageB, sort_order: 2 },
		]);
	});

	it("rejects publishing when slug already belongs to another post", async () => {
		const { db, env } = sqliteAdminEnv();
		insertPublicPost(db, {
			id: "existing",
			slug: "same-slug",
			title: "Existing",
		});
		const session = await usableLogin(env);
		const draft = await createDraftThroughApi(env, session, "Conflict");
		await updateDraftThroughApi(env, session, draft.id, {
			title: "Conflict",
			slug: "same-slug",
			excerpt: "A conflict",
			markdown: "This slug is taken.",
			category: "Life",
			tags: ["local"],
			commentsEnabled: true,
		});

		const response = await handleAdminApi(
			adminRequest(`/api/admin/local-posts/${String(draft.id)}/publish`, {
				headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: { code: "BAD_REQUEST", message: "Slug already exists" },
		});
	});

	it("unpublishes a local post by archiving the public row", async () => {
		const { db, env } = sqliteAdminEnv();
		const session = await usableLogin(env);
		const draft = await createAndPublishLocalPost(env, session);

		const response = await handleAdminApi(
			adminRequest(`/api/admin/local-posts/${String(draft.id)}/unpublish`, {
				headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(200);
		expect(
			sqliteRows(
				db,
				`SELECT p.visibility, d.status
				 FROM posts p
				 JOIN post_drafts d ON d.post_id = p.id`,
			),
		).toEqual([{ visibility: "archived", status: "draft" }]);
	});
});
