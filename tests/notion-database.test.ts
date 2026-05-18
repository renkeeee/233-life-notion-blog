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

	it("accepts a raw 32-character Notion database id", () => {
		expect(parseNotionDatabaseId("c5e926f6cd3c4671bb0b86737143570b")).toBe(
			"c5e926f6cd3c4671bb0b86737143570b",
		);
	});

	it("accepts a dashed UUID-style Notion database id", () => {
		expect(
			parseNotionDatabaseId("c5e926f6-cd3c-4671-bb0b-86737143570b"),
		).toBe("c5e926f6cd3c4671bb0b86737143570b");
	});

	it("lowercases uppercase database ids", () => {
		expect(parseNotionDatabaseId("C5E926F6CD3C4671BB0B86737143570B")).toBe(
			"c5e926f6cd3c4671bb0b86737143570b",
		);
	});

	it("throws for invalid input", () => {
		expect(() => parseNotionDatabaseId("not a database id")).toThrow(
			"Invalid Notion database URL or id",
		);
	});

	it("throws for overlong adjacent hex input instead of truncating", () => {
		expect(() =>
			parseNotionDatabaseId("c5e926f6cd3c4671bb0b86737143570b0"),
		).toThrow("Invalid Notion database URL or id");
	});

	it("throws when a Notion URL contains multiple database id segments", () => {
		expect(() =>
			parseNotionDatabaseId(
				"https://www.notion.so/renke-me/c5e926f6cd3c4671bb0b86737143570b/0123456789abcdef0123456789abcdef",
			),
		).toThrow("Invalid Notion database URL or id");
	});
});
