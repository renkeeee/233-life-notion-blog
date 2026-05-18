import { describe, expect, it } from "vitest";
import { parseNotionDatabaseId } from "../workers/notion/database";

describe("parseNotionDatabaseId", () => {
	it("extracts a 32-character Notion database id from a shared Notion URL", () => {
		expect(
			parseNotionDatabaseId(
				"https://www.notion.so/renke-me/c5e926f6cd3c4671bb0b86737143570b",
			),
		).toBe("c5e926f6cd3c4671bb0b86737143570b");
	});
});
