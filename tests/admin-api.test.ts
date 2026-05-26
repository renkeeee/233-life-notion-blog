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

function fakeR2Bucket(): R2Bucket {
	return {
		async head() {
			return null;
		},
		async put() {
			return null;
		},
	} as unknown as R2Bucket;
}

class SqliteAdminD1 {
	private readonly db = new DatabaseSync(":memory:");

	constructor() {
		this.db.exec("PRAGMA foreign_keys = ON;");
		this.db.exec(schemaSql);
	}

	prepare(sql: string): D1PreparedStatement {
		return new SqliteD1PreparedStatement(
			this.db.prepare(sql),
		) as unknown as D1PreparedStatement;
	}

	rows<T = Record<string, unknown>>(
		sql: string,
		...values: SqlInputValue[]
	): T[] {
		return this.db.prepare(sql).all(...values) as T[];
	}

	asD1(): D1Database {
		return this as unknown as D1Database;
	}
}

function sqliteAdminEnv(): { db: SqliteAdminD1; env: AppEnv } {
	const db = new SqliteAdminD1();
	const now = "2026-05-26T00:00:00.000Z";
	db.prepare(
		`INSERT INTO settings (key, value, encrypted, updated_at)
		 VALUES (?, ?, ?, ?)`,
	)
		.bind("cdnBaseUrl", "https://assets.233.life", 0, now)
		.run();

	return {
		db,
		env: {
			DB: db.asD1(),
			BLOG_ASSETS: fakeR2Bucket(),
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
		const session = await login(env);

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
		const session = await login(env);
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
});
