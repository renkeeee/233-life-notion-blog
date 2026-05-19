import { describe, expect, it } from "vitest";
import { decryptString, generateEncryptionKey } from "../workers/crypto";
import { SettingsRepository } from "../workers/db/d1";
import {
	parseSettingsFromRows,
	redactSettings,
	serializeSettingsForStorage,
	type SettingRow,
} from "../workers/settings";
import type { SiteSettings } from "../workers/types";

const expectedSettingKeys = [
	"siteTitle",
	"notionDatabaseUrl",
	"notionDatabaseId",
	"notionToken",
	"cdnBaseUrl",
	"fieldMapping",
];

function testSettings(notionToken = "ntn_secret"): SiteSettings {
	return {
		siteTitle: "233 Life",
		notionDatabaseUrl:
			"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
		notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
		notionToken,
		cdnBaseUrl: "https://cdn.example.com",
		fieldMapping: {
			title: "Name",
			status: "Status",
			category: "Category",
			tags: "Tags",
			publishedStatusValues: ["Published", "已发布"],
		},
	};
}

function settingRow(
	key: string,
	value: string,
	encrypted: 0 | 1 = 0,
): SettingRow {
	return {
		key,
		value,
		encrypted,
		updated_at: "2026-05-18T00:00:00.000Z",
	};
}

describe("settings storage helpers", () => {
	it("encrypts sensitive settings before persistence", async () => {
		const rootKey = generateEncryptionKey();
		const rows = await serializeSettingsForStorage(testSettings(), rootKey);
		const tokenRow = rows.find((row) => row.key === "notionToken");

		expect(tokenRow?.encrypted).toBe(1);
		expect(tokenRow?.value).not.toBe("ntn_secret");
		expect(await decryptString(tokenRow!.value, rootKey)).toBe("ntn_secret");
	});

	it("serializes exactly the expected setting keys", async () => {
		const rows = await serializeSettingsForStorage(
			testSettings(),
			generateEncryptionKey(),
		);

		expect(rows.map((row) => row.key)).toEqual(expectedSettingKeys);
	});

	it("rejects redacted settings objects before persistence", async () => {
		const rootKey = generateEncryptionKey();

		await expect(
			serializeSettingsForStorage(
				redactSettings(testSettings()) as unknown as SiteSettings,
				rootKey,
			),
		).rejects.toThrow("Unknown setting key: hasNotionToken");
	});

	it("redacts sensitive values for admin reads", () => {
		expect(redactSettings(testSettings())).toMatchObject({
			notionToken: "",
			hasNotionToken: true,
		});
		expect(redactSettings(testSettings(""))).toMatchObject({
			notionToken: "",
			hasNotionToken: false,
		});
	});

	it("round trips stored settings through parsing and decryption", async () => {
		const rootKey = generateEncryptionKey();
		const settings = testSettings();
		const rows = await serializeSettingsForStorage(settings, rootKey);

		await expect(parseSettingsFromRows(rows, rootKey)).resolves.toEqual(settings);
	});

	it("parses field mapping JSON, keeps tags, and ignores removed mapping keys", async () => {
		const rootKey = generateEncryptionKey();
		const parsed = await parseSettingsFromRows(
			[
				settingRow("siteTitle", "233 Life"),
				settingRow("notionDatabaseUrl", "url"),
				settingRow("notionDatabaseId", "id"),
				settingRow("notionToken", "ntn_secret"),
				settingRow("cdnBaseUrl", "https://cdn.example.com"),
				settingRow(
					"fieldMapping",
					JSON.stringify({
						title: "Name",
						status: "Status",
						category: "Category",
						publishedAt: "Published At",
						publishedStatusValues: ["Live", "Ready"],
						summary: "Summary",
						tags: "Tags",
						cover: "Cover",
					}),
				),
			],
			rootKey,
		);

		expect(parsed.fieldMapping).toEqual({
			title: "Name",
			status: "Status",
			category: "Category",
			tags: "Tags",
			publishedAt: "Published At",
			publishedStatusValues: ["Live", "Ready"],
		});
	});

	it("defaults published status values for older stored field mappings", async () => {
		const rootKey = generateEncryptionKey();
		const parsed = await parseSettingsFromRows(
			[
				settingRow("siteTitle", "233 Life"),
				settingRow("notionDatabaseUrl", "url"),
				settingRow("notionDatabaseId", "id"),
				settingRow("notionToken", "ntn_secret"),
				settingRow("cdnBaseUrl", "https://cdn.example.com"),
				settingRow(
					"fieldMapping",
					JSON.stringify({ title: "Name", status: "Status" }),
				),
			],
			rootKey,
		);

		expect(parsed.fieldMapping.tags).toBe("Tags");
		expect(parsed.fieldMapping.category).toBe("Category");
		expect(parsed.fieldMapping.publishedStatusValues).toEqual([
			"Published",
			"已发布",
		]);
	});

	it("keeps an explicitly disabled tags mapping", async () => {
		const rootKey = generateEncryptionKey();
		const parsed = await parseSettingsFromRows(
			[
				settingRow("siteTitle", "233 Life"),
				settingRow("notionDatabaseUrl", "url"),
				settingRow("notionDatabaseId", "id"),
				settingRow("notionToken", "ntn_secret"),
				settingRow("cdnBaseUrl", "https://cdn.example.com"),
				settingRow(
					"fieldMapping",
					JSON.stringify({ title: "Name", status: "Status", tags: "" }),
				),
			],
			rootKey,
		);

		expect(parsed.fieldMapping.tags).toBe("");
	});

	it("keeps an explicitly disabled category mapping", async () => {
		const rootKey = generateEncryptionKey();
		const parsed = await parseSettingsFromRows(
			[
				settingRow("siteTitle", "233 Life"),
				settingRow("notionDatabaseUrl", "url"),
				settingRow("notionDatabaseId", "id"),
				settingRow("notionToken", "ntn_secret"),
				settingRow("cdnBaseUrl", "https://cdn.example.com"),
				settingRow(
					"fieldMapping",
					JSON.stringify({ title: "Name", status: "Status", category: "" }),
				),
			],
			rootKey,
		);

		expect(parsed.fieldMapping.category).toBe("");
	});

	it("throws when required settings are missing", async () => {
		const rootKey = generateEncryptionKey();

		await expect(
			parseSettingsFromRows(
				[
					settingRow("notionDatabaseUrl", "url"),
					settingRow("notionDatabaseId", "id"),
					settingRow("notionToken", "ntn_secret"),
					settingRow("cdnBaseUrl", "https://cdn.example.com"),
					settingRow(
						"fieldMapping",
						JSON.stringify({ title: "Name", status: "Status" }),
					),
				],
				rootKey,
			),
		).rejects.toThrow("Missing setting: siteTitle");
	});
});

describe("SettingsRepository", () => {
	it("uses D1 batch when upserting multiple setting rows", async () => {
		let batchedStatements: D1PreparedStatement[] | null = null;
		const db = {
			prepare(sql: string) {
				return {
					sql,
					bind(...values: unknown[]) {
						return { sql, values };
					},
				};
			},
			async batch(statements: D1PreparedStatement[]) {
				batchedStatements = statements;
				return [];
			},
		} as unknown as D1Database;
		const repository = new SettingsRepository(db);

		await repository.putMany([
			settingRow("siteTitle", "233 Life"),
			settingRow("notionToken", "encrypted-token", 1),
		]);

		expect(batchedStatements).toEqual([
			expect.objectContaining({
				sql: expect.stringContaining("ON CONFLICT(key) DO UPDATE"),
				values: [
					"siteTitle",
					"233 Life",
					0,
					"2026-05-18T00:00:00.000Z",
				],
			}),
			expect.objectContaining({
				values: [
					"notionToken",
					"encrypted-token",
					1,
					"2026-05-18T00:00:00.000Z",
				],
			}),
		]);
	});

	it("upserts multiple setting rows", async () => {
		const statements: { sql: string; values: unknown[] }[] = [];
		const db = {
			prepare(sql: string) {
				return {
					bind(...values: unknown[]) {
						return {
							async run() {
								statements.push({ sql, values });
							},
						};
					},
				};
			},
		} as unknown as D1Database;
		const repository = new SettingsRepository(db);

		await repository.putMany([
			settingRow("siteTitle", "233 Life"),
			settingRow("notionToken", "encrypted-token", 1),
		]);

		expect(statements).toHaveLength(2);
		expect(statements[0]?.sql).toContain("ON CONFLICT(key) DO UPDATE");
		expect(statements[0]?.values).toEqual([
			"siteTitle",
			"233 Life",
			0,
			"2026-05-18T00:00:00.000Z",
		]);
		expect(statements[1]?.values).toEqual([
			"notionToken",
			"encrypted-token",
			1,
			"2026-05-18T00:00:00.000Z",
		]);
	});

	it("lists all setting rows", async () => {
		const rows = [
			settingRow("cdnBaseUrl", "https://cdn.example.com"),
			settingRow("siteTitle", "233 Life"),
		];
		const db = {
			prepare(sql: string) {
				return {
					async all() {
						return { results: rows, success: true };
					},
					sql,
				};
			},
		} as unknown as D1Database;
		const repository = new SettingsRepository(db);

		await expect(repository.list()).resolves.toEqual(rows);
	});
});
