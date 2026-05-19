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

	async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
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

	exec(sql: string): void {
		this.db.exec(sql);
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
		notionDatabaseUrl:
			"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
		notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
		notionToken: "ntn_secret",
		cdnBaseUrl: "https://cdn.example.com",
		fieldMapping: {
			title: "Name",
			status: "Status",
			tags: "Tags",
			publishedAt: "Published At",
			publishedStatusValues: ["Published", "已发布"],
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
		cover: {
			type: "external",
			external: { url: "https://notion-assets.example.com/page-cover.png" },
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

	it("uses configured published status values", () => {
		expect(syncVisibilityForStatus("Live", ["Live", "Ready"])).toBe("published");
		expect(syncVisibilityForStatus("Published", ["Live", "Ready"])).toBe(
			"hidden",
		);
	});
});

describe("Notion page mapping", () => {
	it("maps only supported Notion properties and uses the page cover", () => {
		expect(
			mapNotionPageToPostMetadata(syncPage(), settings().fieldMapping),
		).toMatchObject({
			id: "notion-page-1",
			notionPageId: "notion-page-1",
			slug: "hello-notion",
			title: "Hello Notion",
			coverUrl: "https://notion-assets.example.com/page-cover.png",
			tags: ["Life", "Notes"],
			status: "Published",
			visibility: "published",
			publishedAt: "2026-05-18",
			notionLastEditedTime: "2026-05-18T02:30:00.000Z",
		});
	});

	it("falls back to the Notion created time when no published date field is mapped", () => {
		expect(
			mapNotionPageToPostMetadata(syncPage(), {
				title: "Name",
				status: "Status",
				publishedStatusValues: ["Published", "已发布"],
			}),
		).toMatchObject({
			publishedAt: "2026-05-17T00:00:00.000Z",
		});
	});

	it("uses configured published status values when mapping visibility", () => {
		expect(
			mapNotionPageToPostMetadata(
				syncPage({
					properties: {
						...syncPage().properties,
						Status: {
							type: "status",
							status: { name: "Live" },
						},
					},
				}),
				{
					title: "Name",
					status: "Status",
					publishedStatusValues: ["Live"],
				},
			),
		).toMatchObject({
			status: "Live",
			visibility: "published",
		});
	});
});

describe("runSync", () => {
	it("uses the previous successful run start time as the incremental lower bound", async () => {
		const db = new SqliteD1Database();
		try {
			await seedSettings(db);
			db.exec(
				`INSERT INTO sync_runs (
					id, trigger_type, started_at, finished_at, status, force
				)
				VALUES (
					'previous-run', 'cron',
					'2026-05-18T00:00:00.000Z',
					'2026-05-18T00:05:00.000Z',
					'success', 0
				)`,
			);

			await runSync(
				envWithDb(db),
				{ triggerType: "cron", force: false },
				{
					id: (() => {
						let index = 0;
						return () => {
							index += 1;
							return index === 1 ? "run-window" : `item-${index}`;
						};
					})(),
					now: () => fixedNow,
					notionSource: {
						async listPages(_settings, window) {
							expect(window).toEqual({
								start: "2026-05-18T00:00:00.000Z",
								end: null,
							});
							return [];
						},
						async listBlocks() {
							return [];
						},
					},
				},
			);
		} finally {
			db.close();
		}
	});

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
				cover_url: string | null;
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
			const tags = db.rows<{ tag: string; sort_order: number }>(
				"SELECT tag, sort_order FROM post_tags WHERE post_id = ? ORDER BY sort_order",
				"notion-page-1",
			);

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
				cover_url: asset.cdn_url,
				visibility: "published",
				last_sync_error: null,
			});
			expect(post.content_hash).toBe(content.content_hash);
			expect(content.markdown).toContain("Hello body");
			expect(content.markdown).toContain("https://cdn.example.com/assets/");
			expect(content.markdown).not.toContain("https://notion-assets.example.com");
			expect(tags).toEqual([
				{ tag: "Life", sort_order: 0 },
				{ tag: "Notes", sort_order: 1 },
			]);
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

	it("refreshes metadata for unchanged existing pages before skipping content sync", async () => {
		const db = new SqliteD1Database();
		try {
			await seedSettings(db);
			db.exec(
				`INSERT INTO posts (
					id, notion_page_id, slug, title, cover_url, status, visibility,
					published_at, notion_last_edited_time, content_hash,
					last_sync_error, created_at, updated_at
				)
				VALUES (
					'existing-post', 'notion-page-1', 'untitled', 'Untitled',
					'https://cdn.example.com/old-cover.png', '', 'hidden',
					'2026-05-17T00:00:00.000Z', '2026-05-18T02:30:00.000Z',
					'old-content-hash', 'previous error',
					'2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z'
				)`,
			);

			await runSync(
				envWithDb(db),
				{ triggerType: "manual", force: false },
				{
					id: (() => {
						let index = 0;
						return () => {
							index += 1;
							return index === 1 ? "run-1" : `item-${index - 1}`;
						};
					})(),
					now: () => fixedNow,
					notionSource: {
						async listPages() {
							return [syncPage()];
						},
						async listBlocks() {
							throw new Error("content blocks should not be fetched");
						},
					},
				},
			);

			expect(
				db.row<{
					slug: string;
					title: string;
					status: string;
					visibility: string;
					published_at: string | null;
					content_hash: string | null;
					last_sync_error: string | null;
				}>("SELECT * FROM posts WHERE id = ?", "existing-post"),
			).toMatchObject({
				slug: "hello-notion",
				title: "Hello Notion",
				status: "Published",
				visibility: "published",
				published_at: "2026-05-18",
				content_hash: "old-content-hash",
				last_sync_error: null,
			});
			expect(
				db.row<{ action: string; status: string; post_id: string | null }>(
					"SELECT action, status, post_id FROM sync_items WHERE sync_run_id = ?",
					"run-1",
				),
			).toEqual({
				action: "metadata_only",
				status: "success",
				post_id: "existing-post",
			});
			expect(
				db.row<{
					metadata_only_count: number;
					skipped_count: number;
					unpublished_count: number;
					failed_count: number;
				}>(
					"SELECT metadata_only_count, skipped_count, unpublished_count, failed_count FROM sync_runs WHERE id = ?",
					"run-1",
				),
			).toEqual({
				metadata_only_count: 1,
				skipped_count: 0,
				unpublished_count: 0,
				failed_count: 0,
			});
		} finally {
			db.close();
		}
	});

	it("deduplicates different Notion asset URLs that download to the same content hash", async () => {
		const db = new SqliteD1Database();
		const bucket = new FakeAssetBucket();
		try {
			await seedSettings(db);
			const blocks: NotionBlock[] = [
				{
					id: "image-1",
					type: "image",
					image: {
						type: "external",
						external: { url: "https://notion-assets.example.com/a.png" },
					},
				},
				{
					id: "image-2",
					type: "image",
					image: {
						type: "external",
						external: { url: "https://notion-assets.example.com/b.png" },
					},
				},
			];

			await runSync(
				envWithDb(db, bucket),
				{ triggerType: "manual", force: true },
				syncDependencies([syncPage()], blocks),
			);

			expect(
				db.row<{ status: string; created_count: number; failed_count: number }>(
					"SELECT status, created_count, failed_count FROM sync_runs WHERE id = ?",
					"run-1",
				),
			).toEqual({
				status: "success",
				created_count: 1,
				failed_count: 0,
			});
			expect(db.rows("SELECT * FROM assets")).toHaveLength(1);
			expect(bucket.puts).toHaveLength(1);
			const content = db.row<{ markdown: string }>(
				"SELECT markdown FROM post_content WHERE post_id = ?",
				"notion-page-1",
			);
			expect(content.markdown).toContain("https://cdn.example.com/assets/");
			expect(content.markdown).not.toContain("notion-assets.example.com");
		} finally {
			db.close();
		}
	});

	it("does not publish a new post row when content persistence fails", async () => {
		const db = new SqliteD1Database();
		try {
			await seedSettings(db);
			db.exec(
				`CREATE TRIGGER fail_post_content_insert
				 BEFORE INSERT ON post_content
				 BEGIN
					SELECT RAISE(FAIL, 'post content unavailable');
				 END;`,
			);

			await runSync(
				envWithDb(db),
				{ triggerType: "manual", force: true },
				syncDependencies([syncPage()]),
			);

			expect(
				db.row<{ status: string; created_count: number; failed_count: number }>(
					"SELECT status, created_count, failed_count FROM sync_runs WHERE id = ?",
					"run-1",
				),
			).toEqual({
				status: "partial",
				created_count: 0,
				failed_count: 1,
			});
			expect(
				db.rows("SELECT * FROM posts WHERE notion_page_id = ?", "notion-page-1"),
			).toHaveLength(0);
			expect(
				db.row<{ status: string; post_id: string | null }>(
					"SELECT status, post_id FROM sync_items WHERE sync_run_id = ?",
					"run-1",
				),
			).toEqual({ status: "failed", post_id: null });
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

	it("accepts ISO sync ranges with timezone offsets", async () => {
		const db = new SqliteD1Database();
		try {
			await seedChangedPassword(db);
			const env = envWithDb(db);
			const session = await loginSession(env);
			const response = await handleAdminApi(
				adminRequest("/api/admin/sync", {
					body: JSON.stringify({
						rangeStart: "2026-01-01T00:30:00+02:00",
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
				{
					runSync: async (_env, input) => {
						expect(input.rangeStart).toBe("2026-01-01T00:30:00+02:00");
						return { runId: "offset-run" };
					},
				},
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({ runId: "offset-run" });
		} finally {
			db.close();
		}
	});
});

describe("admin posts API", () => {
	it("lists synced posts including hidden entries for authenticated admins", async () => {
		const db = new SqliteD1Database();
		try {
			await seedChangedPassword(db);
			db.exec(
				`INSERT INTO posts (
					id, notion_page_id, slug, title, cover_url, status, visibility,
					published_at, notion_last_edited_time, content_hash,
					last_sync_error, created_at, updated_at
				)
				VALUES (
					'post-1', 'notion-page-1', 'untitled', 'Untitled',
					NULL, '', 'hidden', NULL, '2026-05-19T03:43:00.000Z',
					'content-hash', NULL,
					'2026-05-19T03:40:00.000Z', '2026-05-19T03:50:24.214Z'
				)`,
			);
			const env = envWithDb(db);
			const session = await loginSession(env);

			const unauthenticated = await handleAdminApi(
				adminRequest("/api/admin/posts", { method: "GET" }),
				env,
			);
			const response = await handleAdminApi(
				adminRequest("/api/admin/posts", {
					headers: { cookie: session.cookie },
					method: "GET",
				}),
				env,
			);

			expect(unauthenticated.status).toBe(401);
			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				items: [
					{
						id: "post-1",
						title: "Untitled",
						slug: "untitled",
						status: "",
						visibility: "hidden",
						publishedAt: null,
						notionLastEditedTime: "2026-05-19T03:43:00.000Z",
						updatedAt: "2026-05-19T03:50:24.214Z",
						lastSyncError: null,
					},
				],
				total: 1,
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
