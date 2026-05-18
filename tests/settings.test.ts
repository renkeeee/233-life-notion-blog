import { describe, expect, it } from "vitest";
import { decryptString, generateEncryptionKey } from "../workers/crypto";
import { redactSettings, serializeSettingsForStorage } from "../workers/settings";

describe("settings storage helpers", () => {
	it("encrypts sensitive settings before persistence", async () => {
		const rootKey = generateEncryptionKey();
		const rows = await serializeSettingsForStorage(
			{
				siteTitle: "233 Life",
				notionDatabaseUrl:
					"https://www.notion.so/renke-me/c5e926f6cd3c4671bb0b86737143570b",
				notionDatabaseId: "c5e926f6cd3c4671bb0b86737143570b",
				notionToken: "ntn_secret",
				cdnBaseUrl: "https://cdn.example.com",
				fieldMapping: { title: "Name", status: "Status" },
			},
			rootKey,
		);
		const tokenRow = rows.find((row) => row.key === "notionToken");

		expect(tokenRow?.encrypted).toBe(1);
		expect(tokenRow?.value).not.toBe("ntn_secret");
		expect(await decryptString(tokenRow!.value, rootKey)).toBe("ntn_secret");
	});

	it("redacts sensitive values for admin reads", () => {
		expect(
			redactSettings({
				siteTitle: "233 Life",
				notionDatabaseUrl: "url",
				notionDatabaseId: "id",
				notionToken: "ntn_secret",
				cdnBaseUrl: "https://cdn.example.com",
				fieldMapping: { title: "Name", status: "Status" },
			}),
		).toMatchObject({ notionToken: "" });
	});
});
