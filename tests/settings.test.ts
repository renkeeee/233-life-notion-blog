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

function testSettings(notionToken = "ntn_secret"): SiteSettings {
	return {
		siteTitle: "233 Life",
		notionDatabaseUrl:
			"https://www.notion.so/renke-me/c5e926f6cd3c4671bb0b86737143570b",
		notionDatabaseId: "c5e926f6cd3c4671bb0b86737143570b",
		notionToken,
		cdnBaseUrl: "https://cdn.example.com",
		fieldMapping: { title: "Name", status: "Status" },
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

	it("parses field mapping JSON from stored rows", async () => {
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
					JSON.stringify({ title: "Name", status: "Status", tags: "Tags" }),
				),
			],
			rootKey,
		);

		expect(parsed.fieldMapping).toEqual({
			title: "Name",
			status: "Status",
			tags: "Tags",
		});
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
});
