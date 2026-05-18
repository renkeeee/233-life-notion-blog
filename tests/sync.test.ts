/// <reference types="node" />

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import worker from "../workers/app";
import { handleAdminApi } from "../workers/api/admin";
import { hashPassword, generateEncryptionKey } from "../workers/crypto";
import schemaSql from "../workers/db/schema.sql?raw";
import type { NotionBlock } from "../workers/notion/blocks";
import {
	mapNotionPageToPostMetadata,
	planSyncWindow,
	runSync,
	syncVisibilityForStatus,
	type NotionSyncPage,
	type SyncDependencies,
} from "../workers/sync";
import { serializeSettingsForStorage, type SettingRow } from "../workers/settings";
import type { AppEnv, SiteSettings } from "../workers/types";

type SqlInputValue = string | number | bigint | null | Uint8Array;
type WorkerRequest = Parameters<NonNullable<typeof worker.fetch>>[0];

class SqliteD1PreparedStatement {
	private values: unknown[] = [];

	constructor(
		private readonly statement: ReturnType<DatabaseSync["prepare"]>,
		private readonly sql: string,
		private readonly calls: Array<{ sql: string; values: unknown[] }>,
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
	readonly calls: Array<{ sql: string; values: unknown[] }> = [];
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

	insertSetting(row: SettingRow): void {
		this.db
			.prepare(
				`INSERT INTO settings (key, value, encrypted, updated_at)
				 VALUES (?, ?, ?, ?)`,
			)
			.run(row.key, row.value, row.encrypted, row.updated_at);
	}

	row<T = Record<string, unknown>>(sql: string, ...values: SqlInputValue[]): T {
		const row = this.db.prepare(sql).get(...values);
		if (!row) {
			throw new Error(`Missing row for ${sql}`);
		}
		return row as T;
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

	close(): void {
		this.db.close();
	}
}

class FakeAssetBucket {
	readonly puts: Array<{
		key: string;
		body: ArrayBuffer | string | ArrayBufferView | Blob | ReadableStream;
		options?: { httpMetadata?: { contentType?: string } };
	}> = [];
	private readonly existing = new Set<string>();

	async head(key: string): Promise<unknown | null> {
		return this.existing.has(key) ? { key } : null;
	}

	async put(
		key: string,
		body: ArrayBuffer | string | ArrayBufferView | Blob | ReadableStream,
		options?: { httpMetadata?: { contentType?: string } },
	): Promise<unknown> {
		this.existing.add(key);
		this.puts.push({ key, body, options });
		return { key };
	}

	asR2(): R2Bucket {
		return this as unknown as R2Bucket;
	}
}

const fixedNow = "2026-05-18T12:00:00.000Z";
const rootKey = generateEncryptionKey();

function settings(): SiteSettings {
	return {
		siteTitle: "233 Life",
		notionDatabaseUrl: "https://www.notion.so/renke-me/c5e926f6cd3c4671bb0b86737143570b",
		notionDatabaseId: "c5e926f6cd3c4671bb0b86737143570b",
		notionToken: "ntn_secret",
		cdnBaseUrl: "https://cdn.example.com",
		fieldMapping: {
			title: "Name",
			slug: "Slug",
			summary: "Summary",
			tags: "Tags",
			status: "Status",
			publishedAt: "Published At",
		},
	};
}

async function seedSettings(db: SqliteD1Database): Promise<void> {
	const rows = await serializeSettingsForStorage(settings(), rootKey, fixedNow);
	for (const row of rows) {
		db.insertSetting(row);
	}
}

async function seedChangedPassword(db: SqliteD1Database): Promise<void> {
	db.insertSetting({
		key: "adminPasswordHash",
		value: await hashPassword("changed-password"),
		encrypted: 0,
		updated_at: fixedNow,
	});
}

function envWithDb(db: SqliteD1Database, bucket = new FakeAssetBucket()): AppEnv {
	return {
		DB: db.asD1(),
		BLOG_ASSETS: bucket.asR2(),
		CONFIG_ENCRYPTION_KEY: rootKey,
	};
}

function syncPage(overrides: Partial<NotionSyncPage> = {}): NotionSyncPage {
	return {
		id: "notion-page-1",
		created_time: "2026-05-17T00:00:00.000Z",
		last_edited_time: "2026-05-18T02:30:00.000Z",
		archived: false,
		in_trash: false,
		properties: {
			Name: {
				type: "title",
				title: [{ plain_text: "Hello Notion" }],
			},
			Slug: {
				type: "rich_text",
				rich_text: [{ plain_text: "hello-notion" }],
			},
			Summary: {
				type: "rich_text",
				rich_text: [{ plain_text: "A synced summary" }],
			},
			Tags: {
				type: "multi_select",
				multi_select: [{ name: "Life" }, { name: "Notes" }],
			},
			Status: {
				type: "status",
				status: { name: "Published" },
			},
			"Published At": {
				type: "date",
				date: { start: "2026-05-18" },
			},
		},
		...overrides,
	};
}

function pageBlocks(): NotionBlock[] {
	return [
		{
			id: "block-1",
			type: "paragraph",
			paragraph: {
				rich_text: [{ plain_text: "Hello body" }],
			},
		},
		{
			id: "block-image",
			type: "image",
			image: {
				type: "external",
				external: { url: "https://notion-assets.example.com/image.png" },
				caption: [{ plain_text: "Cover image" }],
			},
		},
	];
}

function syncDependencies(
	pages: NotionSyncPage[],
	blocks: NotionBlock[] = pageBlocks(),
): SyncDependencies {
	return {
		id: (() => {
			let index = 0;
			return () => {
				index += 1;
				return index === 1 ? "run-1" : `item-${index - 1}`;
			};
		})(),
		now: () => fixedNow,
		fetcher: async () =>
			new Response(new Uint8Array([1, 2, 3, 4]), {
				headers: { "content-type": "image/png" },
			}),
		notionSource: {
			async listPages() {
				return pages;
			},
			async listBlocks(_settings: SiteSettings, pageId: string) {
				expect(pageId).toBe("notion-page-1");
				return blocks;
			},
		},
	};
}

function adminRequest(pathname: string, init: RequestInit = {}): Request {
	return new Request(`https://example.test${pathname}`, init);
}

async function loginSession(env: AppEnv): Promise<{
	cookie: string;
	csrfToken: string;
}> {
	const response = await handleAdminApi(
		adminRequest("/api/admin/login", {
			body: JSON.stringify({ password: "changed-password" }),
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

describe("sync planning", () => {
	it("uses the requested manual range when present", () => {
		expect(
			planSyncWindow({
				lastSuccessfulSync: "2026-05-17T00:00:00.000Z",
				rangeStart: "2026-05-01T00:00:00.000Z",
				rangeEnd: "2026-05-18T00:00:00.000Z",
			}),
		).toEqual({
			start: "2026-05-01T00:00:00.000Z",
			end: "2026-05-18T00:00:00.000Z",
		});
	});

	it("falls back to last successful sync for nightly runs", () => {
		expect(
			planSyncWindow({ lastSuccessfulSync: "2026-05-17T00:00:00.000Z" }),
		).toEqual({
			start: "2026-05-17T00:00:00.000Z",
			end: null,
		});
	});

	it("uses no implicit start when force refreshing without a range", () => {
		expect(
			planSyncWindow({
				lastSuccessfulSync: "2026-05-17T00:00:00.000Z",
				force: true,
			}),
		).toEqual({
			start: null,
			end: null,
		});
	});
});

describe("syncVisibilityForStatus", () => {
	it("publishes only accepted statuses", () => {
		expect(syncVisibilityForStatus("Published")).toBe("published");
		expect(syncVisibilityForStatus("已发布")).toBe("published");
		expect(syncVisibilityForStatus("Draft")).toBe("hidden");
	});
});

describe("Notion page mapping", () => {
	it("maps Notion properties to local post metadata", () => {
		expect(
			mapNotionPageToPostMetadata(syncPage(), settings().fieldMapping),
		).toMatchObject({
			id: "notion-page-1",
			notionPageId: "notion-page-1",
			slug: "hello-notion",
			title: "Hello Notion",
			summary: "A synced summary",
			tags: ["Life", "Notes"],
			status: "Published",
			visibility: "published",
			publishedAt: "2026-05-18",
			notionLastEditedTime: "2026-05-18T02:30:00.000Z",
		});
	});
});

describe("runSync", () => {
	it("writes synced Notion pages, Markdown content, uploaded assets, and sync history", async () => {
		const db = new SqliteD1Database();
		const bucket = new FakeAssetBucket();
		try {
			await seedSettings(db);
			const result = await runSync(
				envWithDb(db, bucket),
				{ triggerType: "manual", force: true },
				syncDependencies([syncPage()]),
			);

			const run = db.row<{
				id: string;
				status: string;
				trigger_type: string;
				force: number;
				created_count: number;
				failed_count: number;
			}>("SELECT * FROM sync_runs WHERE id = ?", "run-1");
			const post = db.row<{
				id: string;
				slug: string;
				title: string;
				summary: string | null;
				tags_json: string;
				visibility: string;
				content_hash: string | null;
				last_sync_error: string | null;
			}>("SELECT * FROM posts WHERE notion_page_id = ?", "notion-page-1");
			const content = db.row<{
				markdown: string;
				block_snapshot_hash: string;
				content_hash: string;
				resource_refs_json: string;
			}>("SELECT * FROM post_content WHERE post_id = ?", "notion-page-1");
			const asset = db.row<{ cdn_url: string; mime_type: string | null }>(
				"SELECT * FROM assets",
			);
			const item = db.row<{
				action: string;
				status: string;
				post_id: string | null;
			}>("SELECT * FROM sync_items WHERE sync_run_id = ?", "run-1");

			expect(result).toEqual({ runId: "run-1" });
			expect(run).toMatchObject({
				id: "run-1",
				status: "success",
				trigger_type: "manual",
				force: 1,
				created_count: 1,
				failed_count: 0,
			});
			expect(post).toMatchObject({
				id: "notion-page-1",
				slug: "hello-notion",
				title: "Hello Notion",
				summary: "A synced summary",
				tags_json: JSON.stringify(["Life", "Notes"]),
				visibility: "published",
				last_sync_error: null,
			});
			expect(post.content_hash).toBe(content.content_hash);
			expect(content.markdown).toContain("Hello body");
			expect(content.markdown).toContain("https://cdn.example.com/assets/");
			expect(content.markdown).not.toContain("https://notion-assets.example.com");
			expect(JSON.parse(content.resource_refs_json)).toEqual([
				expect.objectContaining({
					sourceUrl: "https://notion-assets.example.com/image.png",
					cdnUrl: asset.cdn_url,
					blockType: "image",
				}),
			]);
			expect(asset.mime_type).toBe("image/png");
			expect(bucket.puts).toHaveLength(1);
			expect(bucket.puts[0].key).toMatch(/^assets\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/);
			expect(item).toMatchObject({
				action: "created",
				status: "success",
				post_id: "notion-page-1",
			});
		} finally {
			db.close();
		}
	});

	it("marks the sync run failed when the source cannot be queried", async () => {
		const db = new SqliteD1Database();
		try {
			await seedSettings(db);
			await expect(
				runSync(envWithDb(db), { triggerType: "cron", force: false }, {
					id: () => "run-failed",
					now: () => fixedNow,
					notionSource: {
						async listPages() {
							throw new Error("Notion unavailable: secret token");
						},
						async listBlocks() {
							return [];
						},
					},
				}),
			).resolves.toEqual({ runId: "run-failed" });
			expect(
				db.row<{ status: string; error_code: string; error_message: string }>(
					"SELECT status, error_code, error_message FROM sync_runs WHERE id = ?",
					"run-failed",
				),
			).toEqual({
				status: "failed",
				error_code: "INTERNAL_ERROR",
				error_message: "Notion unavailable",
			});
		} finally {
			db.close();
		}
	});
});

describe("admin manual sync API", () => {
	it("requires a usable admin session and CSRF before starting manual sync", async () => {
		const db = new SqliteD1Database();
		try {
			await seedChangedPassword(db);
			await seedSettings(db);
			const env = envWithDb(db);
			const session = await loginSession(env);
			const unauthenticated = await handleAdminApi(
				adminRequest("/api/admin/sync", {
					body: JSON.stringify({
						rangeStart: null,
						rangeEnd: null,
						force: false,
					}),
					headers: { "content-type": "application/json" },
					method: "POST",
				}),
				env,
			);
			const missingCsrf = await handleAdminApi(
				adminRequest("/api/admin/sync", {
					body: JSON.stringify({
						rangeStart: null,
						rangeEnd: null,
						force: false,
					}),
					headers: {
						"content-type": "application/json",
						cookie: session.cookie,
					},
					method: "POST",
				}),
				env,
			);
			const success = await handleAdminApi(
				adminRequest("/api/admin/sync", {
					body: JSON.stringify({
						rangeStart: "2026-05-01T00:00:00.000Z",
						rangeEnd: "2026-05-18T00:00:00.000Z",
						force: true,
					}),
					headers: {
						"content-type": "application/json",
						cookie: session.cookie,
						"x-csrf-token": session.csrfToken,
					},
					method: "POST",
				}),
				env,
				{
					runSync: async (_env, input) => {
						expect(input).toEqual({
							triggerType: "manual",
							rangeStart: "2026-05-01T00:00:00.000Z",
							rangeEnd: "2026-05-18T00:00:00.000Z",
							force: true,
						});
						return { runId: "manual-run-1" };
					},
				},
			);

			expect(unauthenticated.status).toBe(401);
			expect(missingCsrf.status).toBe(403);
			await expect(success.json()).resolves.toEqual({ runId: "manual-run-1" });
		} finally {
			db.close();
		}
	});

	it("requires the manual sync request body fields to be explicit", async () => {
		const db = new SqliteD1Database();
		try {
			await seedChangedPassword(db);
			const env = envWithDb(db);
			const session = await loginSession(env);
			const response = await handleAdminApi(
				adminRequest("/api/admin/sync", {
					body: JSON.stringify({
						rangeStart: null,
						rangeEnd: null,
					}),
					headers: {
						"content-type": "application/json",
						cookie: session.cookie,
						"x-csrf-token": session.csrfToken,
					},
					method: "POST",
				}),
				env,
			);

			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({
				error: {
					code: "BAD_REQUEST",
					message: "force must be a boolean",
				},
			});
		} finally {
			db.close();
		}
	});

	it("rejects invalid manual sync ranges", async () => {
		const db = new SqliteD1Database();
		try {
			await seedChangedPassword(db);
			const env = envWithDb(db);
			const session = await loginSession(env);
			const response = await handleAdminApi(
				adminRequest("/api/admin/sync", {
					body: JSON.stringify({
						rangeStart: "2026-05-18T00:00:00.000Z",
						rangeEnd: "2026-05-01T00:00:00.000Z",
						force: false,
					}),
					headers: {
						"content-type": "application/json",
						cookie: session.cookie,
						"x-csrf-token": session.csrfToken,
					},
					method: "POST",
				}),
				env,
			);

			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({
				error: {
					code: "BAD_REQUEST",
					message: "rangeStart must be before or equal to rangeEnd",
				},
			});
		} finally {
			db.close();
		}
	});

	it("rejects non-ISO manual sync date strings", async () => {
		const db = new SqliteD1Database();
		try {
			await seedChangedPassword(db);
			const env = envWithDb(db);
			const session = await loginSession(env);
			const response = await handleAdminApi(
				adminRequest("/api/admin/sync", {
					body: JSON.stringify({
						rangeStart: "May 18 2026",
						rangeEnd: null,
						force: false,
					}),
					headers: {
						"content-type": "application/json",
						cookie: session.cookie,
						"x-csrf-token": session.csrfToken,
					},
					method: "POST",
				}),
				env,
			);

			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({
				error: {
					code: "BAD_REQUEST",
					message: "rangeStart must be an ISO date string or null",
				},
			});
		} finally {
			db.close();
		}
	});

	it("rejects impossible ISO calendar dates", async () => {
		const db = new SqliteD1Database();
		try {
			await seedChangedPassword(db);
			const env = envWithDb(db);
			const session = await loginSession(env);
			const response = await handleAdminApi(
				adminRequest("/api/admin/sync", {
					body: JSON.stringify({
						rangeStart: "2026-02-30T00:00:00.000Z",
						rangeEnd: null,
						force: false,
					}),
					headers: {
						"content-type": "application/json",
						cookie: session.cookie,
						"x-csrf-token": session.csrfToken,
					},
					method: "POST",
				}),
				env,
			);

			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({
				error: {
					code: "BAD_REQUEST",
					message: "rangeStart must be an ISO date string or null",
				},
			});
		} finally {
			db.close();
		}
	});
});

describe("scheduled sync", () => {
	it("queues the cron sync through waitUntil", async () => {
		const promises: Promise<unknown>[] = [];
		const db = new SqliteD1Database();
		const ctx = {
			waitUntil(promise: Promise<unknown>) {
				expect(promise).toBeInstanceOf(Promise);
				promises.push(promise.catch(() => undefined));
			},
			passThroughOnException() {},
		} as ExecutionContext;

		try {
			worker.scheduled?.(
				{
					cron: "0 18 * * *",
					scheduledTime: Date.parse(fixedNow),
					noRetry() {},
				},
				envWithDb(db),
				ctx,
			);
			await Promise.all(promises);
			expect(promises).toHaveLength(1);
		} finally {
			db.close();
		}
	});
});
