/// <reference types="node" />

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import worker from "../workers/app";
import { handleAdminApi } from "../workers/api/admin";
import { encryptString, hashPassword, generateEncryptionKey } from "../workers/crypto";
import schemaSql from "../workers/db/schema.sql?raw";
import { normalizedBlocksHash, type NotionBlock } from "../workers/notion/blocks";
import {
	excerptFromMarkdown,
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
			category: "Category",
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
			Category: {
				type: "select",
				select: { name: "Reflection" },
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

function syncDependenciesWithIds(
	pages: NotionSyncPage[],
	ids: string[],
	blocks: NotionBlock[] = pageBlocks(),
): SyncDependencies {
	const deps = syncDependencies(pages, blocks);
	let index = 0;

	return {
		...deps,
		id: () => {
			const value = ids[index];
			index += 1;
			return value ?? `generated-${index}`;
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
			category: "Reflection",
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
				excerpt: string;
				cover_url: string | null;
				category: string | null;
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
			const media = db.rows<{
				post_id: string;
				block_id: string | null;
				kind: string;
				url: string;
				caption: string;
				r2_key: string | null;
				content_hash: string | null;
				sort_order: number;
			}>(
				"SELECT post_id, block_id, kind, url, caption, r2_key, content_hash, sort_order FROM post_media WHERE post_id = ?",
				"notion-page-1",
			);
			const albumItems = db.rows<{
				id: string;
				source_type: string;
				source_id: string;
				post_id: string;
				kind: string;
				url: string;
				large_url: string | null;
				title: string;
				caption: string;
				taken_at: string | null;
				visibility: string;
				featured: number;
				sort_order: number;
				source_content_hash: string | null;
			}>(
				`SELECT
					id, source_type, source_id, post_id, kind, url, large_url, title,
					caption, taken_at, visibility, featured, sort_order, source_content_hash
				 FROM album_items
				 WHERE post_id = ?
				 ORDER BY sort_order`,
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
				excerpt: "Hello body",
				cover_url: asset.cdn_url,
				category: "Reflection",
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
			expect(media).toEqual([
				{
					post_id: "notion-page-1",
					block_id: "block-image",
					kind: "image",
					url: asset.cdn_url,
					caption: "Cover image",
					r2_key: expect.stringMatching(/^assets\/[0-9a-f]{2}\/[0-9a-f]{64}\.png$/),
					content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
					sort_order: 0,
				},
			]);
			expect(albumItems).toEqual([
				{
					id: "notion-page-1:block-image:0",
					source_type: "post_media",
					source_id: "notion-page-1:block-image:0",
					post_id: "notion-page-1",
					kind: "image",
					url: asset.cdn_url,
					large_url: asset.cdn_url,
					title: "Cover image",
					caption: "Cover image",
					taken_at: "2026-05-18",
					visibility: "visible",
					featured: 0,
					sort_order: 0,
					source_content_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
				},
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

	it("preserves managed album item fields during forced media resyncs", async () => {
		const db = new SqliteD1Database();
		try {
			await seedSettings(db);
			const env = envWithDb(db);
			await runSync(
				env,
				{ triggerType: "manual", force: true },
				syncDependenciesWithIds([syncPage()], ["run-1", "item-1"]),
			);

			db.exec(
				`UPDATE album_items
				 SET title = 'Edited album title',
					description = 'Edited album description',
					location_name = 'Window desk',
					visibility = 'hidden',
					featured = 1
				 WHERE source_id = 'notion-page-1:block-image:0'`,
			);

			const changedBlocks: NotionBlock[] = pageBlocks().map((block) =>
				block.id === "block-image"
					? ({
							...block,
							image: {
								type: "external",
								external: {
									url: "https://notion-assets.example.com/image.png",
								},
								caption: [{ plain_text: "Updated Notion caption" }],
							},
						} as NotionBlock)
					: block,
			);

			await runSync(
				env,
				{ triggerType: "manual", force: true },
				syncDependenciesWithIds(
					[syncPage({ last_edited_time: "2026-05-19T02:30:00.000Z" })],
					["run-2", "item-2"],
					changedBlocks,
				),
			);

			const item = db.row<{
				title: string;
				description: string;
				location_name: string;
				visibility: string;
				featured: number;
				caption: string;
				url: string;
				source_content_hash: string | null;
			}>(
				`SELECT
					title, description, location_name, visibility, featured, caption,
					url, source_content_hash
				 FROM album_items
				 WHERE source_id = ?`,
				"notion-page-1:block-image:0",
			);

			expect(item).toMatchObject({
				title: "Edited album title",
				description: "Edited album description",
				location_name: "Window desk",
				visibility: "hidden",
				featured: 1,
				caption: "Updated Notion caption",
			});
			expect(item.url).toContain("https://cdn.example.com/assets/");
			expect(item.source_content_hash).toMatch(/^[0-9a-f]{64}$/);
		} finally {
			db.close();
		}
	});

	it("retrieves a single Notion page when a targeted resync is requested", async () => {
		const db = new SqliteD1Database();
		try {
			await seedSettings(db);
			const env = envWithDb(db);
			const result = await runSync(
				env,
				{
					triggerType: "manual",
					force: true,
					notionPageId: "notion-page-1",
				},
				{
					...syncDependencies([], pageBlocks()),
					notionSource: {
						async listPages() {
							throw new Error("listPages should not be used for targeted resync");
						},
						async retrievePage(_settings: SiteSettings, pageId: string) {
							expect(pageId).toBe("notion-page-1");
							return syncPage();
						},
						async listBlocks(_settings, pageId) {
							expect(pageId).toBe("notion-page-1");
							return pageBlocks();
						},
					} as SyncDependencies["notionSource"],
				},
			);

			expect(result).toEqual({ runId: "run-1" });
			expect(
				db.row<{ status: string; created_count: number }>(
					"SELECT status, created_count FROM sync_runs WHERE id = ?",
					"run-1",
				),
			).toEqual({ status: "success", created_count: 1 });
			expect(
				db.row<{ notion_page_id: string; title: string }>(
					"SELECT notion_page_id, title FROM posts WHERE id = ?",
					"notion-page-1",
				),
			).toEqual({
				notion_page_id: "notion-page-1",
				title: "Hello Notion",
			});
		} finally {
			db.close();
		}
	});

	it("skips admin-deleted posts unless the sync is forced", async () => {
		const db = new SqliteD1Database();
		try {
			await seedSettings(db);
			db.exec(
				`INSERT INTO deleted_posts (
					notion_page_id, post_id, slug, title, deleted_at
				)
				VALUES (
					'notion-page-1', 'old-post', 'deleted-post', 'Deleted Post',
					'2026-05-18T11:00:00.000Z'
				)`,
			);

			await runSync(
				envWithDb(db),
				{ triggerType: "manual", force: false },
				syncDependencies([syncPage()]),
			);

			expect(db.rows("SELECT * FROM posts")).toHaveLength(0);
			expect(
				db.row<{ skipped_count: number; created_count: number }>(
					"SELECT skipped_count, created_count FROM sync_runs WHERE id = ?",
					"run-1",
				),
			).toEqual({ skipped_count: 1, created_count: 0 });

			await runSync(
				envWithDb(db),
				{ triggerType: "manual", force: true },
				{
					...syncDependencies([syncPage()]),
					id: (() => {
						let index = 0;
						return () => {
							index += 1;
							return index === 1 ? "run-2" : `run-2-item-${index - 1}`;
						};
					})(),
				},
			);

			expect(
				db.rows("SELECT * FROM deleted_posts WHERE notion_page_id = 'notion-page-1'"),
			).toHaveLength(0);
			expect(
				db.row<{ slug: string }>(
					"SELECT slug FROM posts WHERE notion_page_id = ?",
					"notion-page-1",
				),
			).toEqual({ slug: "hello-notion" });
		} finally {
			db.close();
		}
	});

	it("extracts a compact plain text excerpt from Markdown", () => {
		expect(
			excerptFromMarkdown(
				"# Heading\n\n![Cover image](https://cdn.example.com/image.png)\n\nFirst paragraph with [a link](https://example.com). Second line.",
				80,
			),
		).toBe("Heading First paragraph with a link. Second line.");
		expect(excerptFromMarkdown("Word ".repeat(50), 24)).toBe(
			"Word Word Word Word...",
		);
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
					category: string | null;
					status: string;
					visibility: string;
					published_at: string | null;
					content_hash: string | null;
					last_sync_error: string | null;
				}>("SELECT * FROM posts WHERE id = ?", "existing-post"),
			).toMatchObject({
				slug: "hello-notion",
				title: "Hello Notion",
				category: "Reflection",
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

	it("caches updated page covers when content blocks are unchanged", async () => {
		const db = new SqliteD1Database();
		const bucket = new FakeAssetBucket();
		try {
			await seedSettings(db);
			const blocks = pageBlocks();
			const blockHash = await normalizedBlocksHash(blocks);
			db.exec(
				`INSERT INTO posts (
					id, notion_page_id, slug, title, cover_url, status, visibility,
					published_at, notion_last_edited_time, content_hash,
					last_sync_error, created_at, updated_at
				)
				VALUES (
					'existing-post', 'notion-page-1', 'hello-notion', 'Hello Notion',
					'https://cdn.example.com/old-cover.png', 'Published', 'published',
					'2026-05-17T00:00:00.000Z', '2026-05-18T01:30:00.000Z',
					'old-content-hash', NULL,
					'2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z'
				)`,
			);
			db.exec(
				`INSERT INTO post_content (
					post_id, markdown, block_snapshot_hash, content_hash,
					resource_refs_json, created_at, updated_at
				)
				VALUES (
					'existing-post', 'Hello body', '${blockHash}', 'old-content-hash',
					'[]', '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z'
				)`,
			);

			await runSync(
				envWithDb(db, bucket),
				{ triggerType: "manual", force: false },
				syncDependencies(
					[
						syncPage({
							cover: {
								type: "external",
								external: {
									url: "https://notion-assets.example.com/new-cover.png",
								},
							},
						}),
					],
					blocks,
				),
			);

			const post = db.row<{ cover_url: string | null }>(
				"SELECT cover_url FROM posts WHERE id = ?",
				"existing-post",
			);
			expect(post.cover_url).toMatch(/^https:\/\/cdn\.example\.com\/assets\//);
			expect(post.cover_url).not.toBe(
				"https://notion-assets.example.com/new-cover.png",
			);
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
	it("returns overview dashboard metrics for authenticated admins", async () => {
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
					'post-1', 'notion-page-1', 'published-post', 'Published Post',
					NULL, 'Published', 'published', '2026-05-19T02:00:00.000Z',
					'2026-05-19T03:44:00.000Z', 'content-hash', NULL,
					'2026-05-19T03:41:00.000Z', '2026-05-19T03:51:24.214Z'
				), (
					'post-2', 'notion-page-2', 'broken-post', 'Broken Post',
					NULL, 'Draft', 'hidden', NULL, '2026-05-19T03:45:00.000Z',
					'content-hash-2', 'Asset download failed',
					'2026-05-19T03:42:00.000Z', '2026-05-19T03:52:24.214Z'
				), (
					'post-3', 'notion-page-3', 'manual-hidden', 'Manual Hidden',
					NULL, 'Published', 'published', '2026-05-19T03:00:00.000Z',
					'2026-05-19T03:46:00.000Z', 'content-hash-3', NULL,
					'2026-05-19T03:43:00.000Z', '2026-05-19T03:53:24.214Z'
				)`,
			);
			db.exec(
				`UPDATE posts
				 SET manual_visibility = 'hidden', locked = 1
				 WHERE id = 'post-3'`,
			);
			db.exec(
				`INSERT INTO post_comments (id, post_id, nickname, body, created_at)
				 VALUES (
					'comment-1', 'post-1', 'Ada', 'A small hello.',
					'2026-05-20T10:00:00.000Z'
				 )`,
			);
			db.exec(
				`INSERT INTO sync_runs (
					id, trigger_type, started_at, finished_at, status,
					range_start, range_end, force, failed_count, error_message
				)
				VALUES (
					'run-1', 'cron', '2026-05-20T18:00:00.000Z',
					'2026-05-20T18:02:00.000Z', 'partial',
					NULL, NULL, 0, 2, 'Some pages failed'
				)`,
			);
			const env = envWithDb(db);
			const session = await loginSession(env);

			const unauthenticated = await handleAdminApi(
				adminRequest("/api/admin/overview", { method: "GET" }),
				env,
			);
			const response = await handleAdminApi(
				adminRequest("/api/admin/overview", {
					headers: { cookie: session.cookie },
					method: "GET",
				}),
				env,
			);

			expect(unauthenticated.status).toBe(401);
			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				counts: {
					totalPosts: 3,
					publishedPosts: 1,
					hiddenPosts: 2,
					lockedPosts: 1,
					comments: 1,
				},
				latestSyncRun: {
					id: "run-1",
					triggerType: "cron",
					status: "partial",
					startedAt: "2026-05-20T18:00:00.000Z",
					finishedAt: "2026-05-20T18:02:00.000Z",
					failedCount: 2,
					errorMessage: "Some pages failed",
				},
				failedPosts: [
					{
						id: "post-2",
						title: "Broken Post",
						slug: "broken-post",
						lastSyncError: "Asset download failed",
						updatedAt: "2026-05-19T03:52:24.214Z",
					},
				],
				recentComments: [
					{
						id: "comment-1",
						nickname: "Ada",
						body: "A small hello.",
						createdAt: "2026-05-20T10:00:00.000Z",
						postId: "post-1",
						postTitle: "Published Post",
						postSlug: "published-post",
					},
				],
			});
		} finally {
			db.close();
		}
	});

	it("lists synced posts with pagination, title/status filters, sorting, and management state", async () => {
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
				), (
					'post-2', 'notion-page-2', 'published-post', 'Published Post',
					NULL, 'Published', 'published', '2026-05-19T02:00:00.000Z',
					'2026-05-19T03:44:00.000Z', 'content-hash-2', NULL,
					'2026-05-19T03:41:00.000Z', '2026-05-19T03:51:24.214Z'
				), (
					'post-3', 'notion-page-3', 'draft-post', 'Draft Post',
					NULL, 'Draft', 'hidden', NULL, '2026-05-19T03:45:00.000Z',
					'content-hash-3', NULL,
					'2026-05-19T03:42:00.000Z', '2026-05-19T03:52:24.214Z'
				)`,
			);
			db.exec(
				`UPDATE posts
				 SET manual_visibility = 'hidden',
					 locked = 1,
					 lock_password_encrypted = '${await encryptString("row-secret", rootKey)}'
				 WHERE id = 'post-2'`,
			);
			const env = envWithDb(db);
			const session = await loginSession(env);

			const unauthenticated = await handleAdminApi(
				adminRequest("/api/admin/posts", { method: "GET" }),
				env,
			);
			const response = await handleAdminApi(
				adminRequest(
					"/api/admin/posts?page=1&limit=1&q=post&status=Published&sortBy=updatedAt&sortDirection=asc",
					{
					headers: { cookie: session.cookie },
					method: "GET",
					},
				),
				env,
			);

			expect(unauthenticated.status).toBe(401);
			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				items: [
					{
						id: "post-2",
						title: "Published Post",
						slug: "published-post",
						status: "Published",
						visibility: "published",
						manualVisibility: "hidden",
						locked: true,
						commentsEnabled: true,
						lockPassword: "row-secret",
						publishedAt: "2026-05-19T02:00:00.000Z",
						notionLastEditedTime: "2026-05-19T03:44:00.000Z",
						updatedAt: "2026-05-19T03:51:24.214Z",
						lastSyncError: null,
					},
				],
				total: 1,
				page: 1,
				limit: 1,
			});
		} finally {
			db.close();
		}
	});

	it("lists, moderates, replies to, updates, and deletes comments for authenticated admins", async () => {
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
					'post-1', 'notion-page-1', 'commented-post', 'Commented Post',
					NULL, 'Published', 'published', '2026-05-19T02:00:00.000Z',
					'2026-05-19T03:44:00.000Z', 'content-hash', NULL,
					'2026-05-19T03:41:00.000Z', '2026-05-19T03:51:24.214Z'
				)`,
			);
			db.exec(
				`INSERT INTO post_comments (
					id, post_id, nickname, body, moderation_status,
					reply_body, reply_created_at, created_at
				)
				 VALUES (
					'comment-1', 'post-1', 'Ada', 'A small hello.', 'pending',
					NULL, NULL,
					'2026-05-20T10:00:00.000Z'
				 )`,
			);
			const env = envWithDb(db);
			const session = await loginSession(env);
			const headers = {
				cookie: session.cookie,
				"content-type": "application/json",
				"x-csrf-token": session.csrfToken,
			};

			const list = await handleAdminApi(
				adminRequest("/api/admin/posts/post-1/comments", {
					headers: { cookie: session.cookie },
					method: "GET",
				}),
				env,
			);
			const update = await handleAdminApi(
				adminRequest("/api/admin/posts/post-1/comments", {
					body: JSON.stringify({ enabled: false }),
					headers,
					method: "PUT",
				}),
				env,
			);
			const moderate = await handleAdminApi(
				adminRequest("/api/admin/posts/post-1/comments/comment-1", {
					body: JSON.stringify({
						moderationStatus: "approved",
						replyBody: "Thanks for stopping by.",
					}),
					headers,
					method: "PUT",
				}),
				env,
			);

			expect(list.status).toBe(200);
			await expect(list.json()).resolves.toEqual({
				post: {
					id: "post-1",
					title: "Commented Post",
					commentsEnabled: true,
				},
				comments: [
					{
						id: "comment-1",
						nickname: "Ada",
						body: "A small hello.",
						moderationStatus: "pending",
						replyBody: null,
						replyCreatedAt: null,
						createdAt: "2026-05-20T10:00:00.000Z",
					},
				],
			});
			expect(update.status).toBe(200);
			await expect(update.json()).resolves.toEqual({
				post: {
					id: "post-1",
					title: "Commented Post",
					commentsEnabled: false,
				},
			});
			expect(
				db.row<{ comments_enabled: number }>(
					"SELECT comments_enabled FROM posts WHERE id = ?",
					"post-1",
				).comments_enabled,
			).toBe(0);
			expect(moderate.status).toBe(200);
			await expect(moderate.json()).resolves.toEqual({
				comment: {
					id: "comment-1",
					nickname: "Ada",
					body: "A small hello.",
					moderationStatus: "approved",
					replyBody: "Thanks for stopping by.",
					replyCreatedAt: expect.any(String),
					createdAt: "2026-05-20T10:00:00.000Z",
				},
			});
			expect(
				db.row<{
					moderation_status: string;
					reply_body: string;
				}>(
					"SELECT moderation_status, reply_body FROM post_comments WHERE id = ?",
					"comment-1",
				),
			).toEqual({
				moderation_status: "approved",
				reply_body: "Thanks for stopping by.",
			});
			const remove = await handleAdminApi(
				adminRequest("/api/admin/posts/post-1/comments/comment-1", {
					headers,
					method: "DELETE",
				}),
				env,
			);
			expect(remove.status).toBe(200);
			expect(
				db.rows("SELECT * FROM post_comments WHERE post_id = 'post-1'"),
			).toHaveLength(0);
		} finally {
			db.close();
		}
	});

	it("saves global and default comment settings for authenticated admins", async () => {
		const db = new SqliteD1Database();
		try {
			await seedChangedPassword(db);
			const env = envWithDb(db);
			const session = await loginSession(env);
			const headers = {
				cookie: session.cookie,
				"content-type": "application/json",
				"x-csrf-token": session.csrfToken,
			};

			const initial = await handleAdminApi(
				adminRequest("/api/admin/posts/comment-settings", {
					headers: { cookie: session.cookie },
					method: "GET",
				}),
				env,
			);
			const update = await handleAdminApi(
				adminRequest("/api/admin/posts/comment-settings", {
					body: JSON.stringify({
						defaultEnabled: false,
						globalEnabled: false,
						moderationEnabled: true,
					}),
					headers,
					method: "PUT",
				}),
				env,
			);
			const saved = await handleAdminApi(
				adminRequest("/api/admin/posts/comment-settings", {
					headers: { cookie: session.cookie },
					method: "GET",
				}),
				env,
			);

			expect(initial.status).toBe(200);
			await expect(initial.json()).resolves.toEqual({
				defaultEnabled: true,
				globalEnabled: true,
				moderationEnabled: false,
			});
			expect(update.status).toBe(200);
			await expect(update.json()).resolves.toEqual({
				defaultEnabled: false,
				globalEnabled: false,
				moderationEnabled: true,
			});
			expect(saved.status).toBe(200);
			await expect(saved.json()).resolves.toEqual({
				defaultEnabled: false,
				globalEnabled: false,
				moderationEnabled: true,
			});
		} finally {
			db.close();
		}
	});

	it("hides, restores, locks, unlocks, and deletes posts for authenticated admins", async () => {
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
					'post-1', 'notion-page-1', 'managed-post', 'Managed Post',
					NULL, 'Published', 'published', '2026-05-19T02:00:00.000Z',
					'2026-05-19T03:44:00.000Z', 'content-hash', NULL,
					'2026-05-19T03:41:00.000Z', '2026-05-19T03:51:24.214Z'
				)`,
			);
			db.exec(
				`INSERT INTO post_content (
					post_id, markdown, block_snapshot_hash, content_hash,
					resource_refs_json, created_at, updated_at
				)
				VALUES (
					'post-1', '# Managed', 'block-hash', 'content-hash',
					'[]', '2026-05-19T03:41:00.000Z', '2026-05-19T03:51:24.214Z'
				)`,
			);
			const env = envWithDb(db);
			const session = await loginSession(env);
			const headers = {
				cookie: session.cookie,
				"content-type": "application/json",
				"x-csrf-token": session.csrfToken,
			};

			const hide = await handleAdminApi(
				adminRequest("/api/admin/posts/post-1/hide", {
					method: "POST",
					headers,
				}),
				env,
			);
			const restore = await handleAdminApi(
				adminRequest("/api/admin/posts/post-1/restore", {
					method: "POST",
					headers,
				}),
				env,
			);
			const lock = await handleAdminApi(
				adminRequest("/api/admin/posts/post-1/lock", {
					method: "POST",
					headers,
					body: JSON.stringify({ password: "post-secret" }),
				}),
				env,
			);
			const unlock = await handleAdminApi(
				adminRequest("/api/admin/posts/post-1/unlock", {
					method: "POST",
					headers,
				}),
				env,
			);
			const remove = await handleAdminApi(
				adminRequest("/api/admin/posts/post-1/delete", {
					method: "POST",
					headers,
				}),
				env,
			);

			expect(hide.status).toBe(200);
			expect(restore.status).toBe(200);
			expect(lock.status).toBe(200);
			expect(unlock.status).toBe(200);
			expect(remove.status).toBe(200);
			expect(
				db.rows("SELECT * FROM posts WHERE id = 'post-1'"),
			).toHaveLength(0);
			expect(
				db.rows("SELECT * FROM post_content WHERE post_id = 'post-1'"),
			).toHaveLength(0);
			expect(
				db.rows("SELECT notion_page_id, post_id, slug, title FROM deleted_posts"),
			).toEqual([
				{
					notion_page_id: "notion-page-1",
					post_id: "post-1",
					slug: "managed-post",
					title: "Managed Post",
				},
			]);
		} finally {
			db.close();
		}
	});

	it("queues a targeted post resync for authenticated admins", async () => {
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
					'post-1', 'notion-page-1', 'managed-post', 'Managed Post',
					NULL, 'Published', 'published', '2026-05-19T02:00:00.000Z',
					'2026-05-19T03:44:00.000Z', 'content-hash', NULL,
					'2026-05-19T03:41:00.000Z', '2026-05-19T03:51:24.214Z'
				)`,
			);
			const env = envWithDb(db);
			const session = await loginSession(env);

			const response = await handleAdminApi(
				adminRequest("/api/admin/posts/post-1/resync", {
					body: JSON.stringify({}),
					headers: {
						cookie: session.cookie,
						"content-type": "application/json",
						"x-csrf-token": session.csrfToken,
					},
					method: "POST",
				}),
				env,
				{
					runSync: async (_env, input) => {
						expect(input).toEqual({
							triggerType: "manual",
							rangeStart: null,
							rangeEnd: null,
							force: true,
							notionPageId: "notion-page-1",
						});
						return { runId: "resync-run-1" };
					},
				},
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				runId: "resync-run-1",
			});
		} finally {
			db.close();
		}
	});
});

describe("admin album API", () => {
	it("lists, updates, hides, restores, deletes album items and manages collections", async () => {
		const db = new SqliteD1Database();
		try {
			await seedChangedPassword(db);
			const env = envWithDb(db);
			const session = await loginSession(env);
			db.exec(
				`INSERT INTO posts (
					id, notion_page_id, slug, title, excerpt, cover_url, category,
					status, visibility, published_at, notion_last_edited_time,
					content_hash, last_sync_error, created_at, updated_at
				)
				VALUES (
					'post-1', 'notion-page-1', 'hello-notion', 'Hello Notion',
					'Excerpt', NULL, 'Journal', 'Published', 'published',
					'2026-05-18', '2026-05-18T02:30:00.000Z', 'hash',
					NULL, '${fixedNow}', '${fixedNow}'
				);
				INSERT INTO album_items (
					id, source_type, source_id, post_id, kind, url, large_url, r2_key,
					title, description, caption, taken_at, location_name, visibility,
					featured, sort_order, source_content_hash, created_at, updated_at
				)
				VALUES (
					'album-1', 'post_media', 'post-media-1', 'post-1', 'image',
					'https://cdn.example.com/assets/photo.jpg',
					'https://cdn.example.com/assets/photo.jpg',
					'assets/photo.jpg', 'Original title', '', 'Original caption',
					'2026-05-18', '', 'visible', 0, 0, 'hash-photo',
					'${fixedNow}', '${fixedNow}'
				);
				INSERT INTO album_collections (
					id, slug, title, description, visibility, sort_order, created_at, updated_at
				)
				VALUES (
					'collection-1', 'daily', 'Daily', '', 'visible', 0,
					'${fixedNow}', '${fixedNow}'
				);
				INSERT INTO album_item_collections (item_id, collection_id, sort_order)
				VALUES ('album-1', 'collection-1', 0);`,
			);

			const listResponse = await handleAdminApi(
				adminRequest("/api/admin/album?limit=5", {
					headers: { cookie: session.cookie },
				}),
				env,
			);
			expect(listResponse.status).toBe(200);
			await expect(listResponse.json()).resolves.toMatchObject({
				total: 1,
				items: [
					{
						id: "album-1",
						title: "Original title",
						visibility: "visible",
						collectionIds: ["collection-1"],
						post: { id: "post-1", slug: "hello-notion", title: "Hello Notion" },
					},
				],
			});

			const updateResponse = await handleAdminApi(
				adminRequest("/api/admin/album/items/album-1", {
					body: JSON.stringify({
						title: "Edited title",
						description: "A small note",
						caption: "Edited caption",
						takenAt: "2026-05-19T00:00:00.000Z",
						locationName: "Shanghai",
						latitude: 31.2304,
						longitude: 121.4737,
						featured: true,
						collectionIds: [],
					}),
					headers: {
						"content-type": "application/json",
						cookie: session.cookie,
						"x-csrf-token": session.csrfToken,
					},
					method: "PUT",
				}),
				env,
			);
			expect(updateResponse.status).toBe(200);
			await expect(updateResponse.json()).resolves.toMatchObject({
				item: {
					id: "album-1",
					title: "Edited title",
					description: "A small note",
					caption: "Edited caption",
					takenAt: "2026-05-19T00:00:00.000Z",
					locationName: "Shanghai",
					latitude: 31.2304,
					longitude: 121.4737,
					featured: true,
					collectionIds: [],
				},
			});

			for (const action of ["hide", "restore"] as const) {
				const response = await handleAdminApi(
					adminRequest(`/api/admin/album/items/album-1/${action}`, {
						headers: {
							cookie: session.cookie,
							"x-csrf-token": session.csrfToken,
						},
						method: "POST",
					}),
					env,
				);
				expect(response.status).toBe(200);
			}

			const createCollectionResponse = await handleAdminApi(
				adminRequest("/api/admin/album/collections", {
					body: JSON.stringify({
						slug: "travels",
						title: "Travels",
						description: "Away days",
						sortOrder: 2,
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
			expect(createCollectionResponse.status).toBe(200);
			await expect(createCollectionResponse.json()).resolves.toMatchObject({
				collection: {
					slug: "travels",
					title: "Travels",
					description: "Away days",
					sortOrder: 2,
				},
			});

			const batchResponse = await handleAdminApi(
				adminRequest("/api/admin/album/batch", {
					body: JSON.stringify({
						itemIds: ["album-1"],
						action: "hide",
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
			expect(batchResponse.status).toBe(200);
			await expect(batchResponse.json()).resolves.toEqual({
				ok: true,
				updated: 1,
			});
			expect(
				db.row<{ visibility: string }>(
					"SELECT visibility FROM album_items WHERE id = ?",
					"album-1",
				).visibility,
			).toBe("hidden");

			const deleteResponse = await handleAdminApi(
				adminRequest("/api/admin/album/items/album-1/delete", {
					headers: {
						cookie: session.cookie,
						"x-csrf-token": session.csrfToken,
					},
					method: "POST",
				}),
				env,
			);
			expect(deleteResponse.status).toBe(200);
			expect(
				db.rows("SELECT id FROM album_items WHERE id = ?", "album-1"),
			).toEqual([]);
		} finally {
			db.close();
		}
	});

	it("uploads manual album media to R2 and creates album items", async () => {
		const db = new SqliteD1Database();
		const bucket = new FakeAssetBucket();
		try {
			await seedSettings(db);
			await seedChangedPassword(db);
			const env = envWithDb(db, bucket);
			const session = await loginSession(env);
			const response = await handleAdminApi(
				adminRequest("/api/admin/album/upload", {
					body: JSON.stringify({
						fileName: "photo.jpg",
						contentType: "image/jpeg",
						contentBase64: btoa(String.fromCharCode(1, 2, 3, 4)),
						title: "Manual upload",
						takenAt: "2026-05-20T00:00:00.000Z",
						featured: true,
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

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				item: {
					sourceType: "manual",
					kind: "image",
					title: "Manual upload",
					takenAt: "2026-05-20T00:00:00.000Z",
					featured: true,
				},
			});
			expect(bucket.puts).toHaveLength(1);
			const row = db.row<{
				source_type: string;
				kind: string;
				url: string;
				title: string;
				featured: number;
			}>("SELECT source_type, kind, url, title, featured FROM album_items");
			expect(row).toMatchObject({
				source_type: "manual",
				kind: "image",
				title: "Manual upload",
				featured: 1,
			});
			expect(row.url).toContain("https://cdn.example.com/assets/");
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
