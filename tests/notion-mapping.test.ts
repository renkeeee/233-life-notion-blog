import { describe, expect, it } from "vitest";
import {
	inferFieldMapping,
	isPublishedStatus,
} from "../workers/notion/database";
import { NotionApiError, NotionClient } from "../workers/notion/client";

const databaseId = "c5e926f6cd3c4671bb0b86737143570b";
const dataSourceId = "0123456789abcdef0123456789abcdef";

describe("inferFieldMapping", () => {
	it("maps common Notion property names to blog fields", () => {
		const mapping = inferFieldMapping({
			Title: property("title"),
			"Post Slug": property("rich_text"),
			Excerpt: property("rich_text"),
			Tags: property("multi_select"),
			Status: property("status"),
			"Published At": property("date"),
			Cover: property("files"),
		});

		expect(mapping).toEqual({
			title: "Title",
			slug: "Post Slug",
			summary: "Excerpt",
			tags: "Tags",
			status: "Status",
			publishedAt: "Published At",
			cover: "Cover",
		});
	});

	it("matches names case-insensitively across spaces, underscores, and hyphens", () => {
		const mapping = inferFieldMapping({
			Name: property("title"),
			"published-status": property("checkbox"),
			"Published_Date": property("created_time"),
			description: property("rich_text"),
			URL: property("url"),
		});

		expect(mapping).toEqual({
			title: "Name",
			slug: "URL",
			summary: "description",
			status: "published-status",
			publishedAt: "Published_Date",
		});
	});

	it("supports Chinese property names", () => {
		const mapping = inferFieldMapping({
			标题: property("title"),
			状态: property("select"),
			摘要: property("rich_text"),
			标签: property("multi_select"),
			发布日期: property("date"),
			封面: property("url"),
		});

		expect(mapping).toEqual({
			title: "标题",
			summary: "摘要",
			tags: "标签",
			status: "状态",
			publishedAt: "发布日期",
			cover: "封面",
		});
	});

	it("does not reuse a title property named Name as the slug", () => {
		const mapping = inferFieldMapping({
			Name: property("title"),
			Published: property("checkbox"),
		});

		expect(mapping).toEqual({
			title: "Name",
			status: "Published",
		});
	});

	it("throws FIELD_MAPPING_INVALID when title is missing", () => {
		expect(() =>
			inferFieldMapping({
				Status: property("status"),
			}),
		).toThrow("FIELD_MAPPING_INVALID");
	});

	it("throws FIELD_MAPPING_INVALID when status is missing", () => {
		expect(() =>
			inferFieldMapping({
				Title: property("title"),
			}),
		).toThrow("FIELD_MAPPING_INVALID");
	});
});

describe("isPublishedStatus", () => {
	it("accepts only explicit published values", () => {
		expect(isPublishedStatus("Published")).toBe(true);
		expect(isPublishedStatus("已发布")).toBe(true);
		expect(isPublishedStatus(true)).toBe(true);

		expect(isPublishedStatus("Draft")).toBe(false);
		expect(isPublishedStatus("published")).toBe(false);
		expect(isPublishedStatus("Public")).toBe(false);
		expect(isPublishedStatus(false)).toBe(false);
		expect(isPublishedStatus(1)).toBe(false);
	});
});

describe("NotionClient", () => {
	it("sends required Notion headers", async () => {
		const requests: Request[] = [];
		const client = new NotionClient("secret-token", {
			fetcher: async (input, init) => {
				requests.push(new Request(input, init));
				return Response.json({ object: "database", id: databaseId, properties: {} });
			},
		});

		await client.retrieveDatabase(databaseId);

		expect(requests[0].url).toBe(
			`https://api.notion.com/v1/databases/${databaseId}`,
		);
		expect(requests[0].headers.get("Authorization")).toBe(
			"Bearer secret-token",
		);
		expect(requests[0].headers.get("Notion-Version")).toBe("2026-03-11");
		expect(requests[0].headers.get("Accept")).toBe("application/json");
		expect(requests[0].headers.get("Content-Type")).toBe("application/json");
	});

	it("throws NotionApiError with parsed error metadata", async () => {
		const client = new NotionClient("secret-token", {
			fetcher: async () =>
				Response.json(
					{ object: "error", code: "unauthorized", message: "Bad token" },
					{ status: 401 },
				),
		});

		const error = await client
			.retrieveDatabase(databaseId)
			.catch((reason: unknown) => reason);

		expect(error).toBeInstanceOf(NotionApiError);
		expect(error).toMatchObject({
			status: 401,
			code: "unauthorized",
			message: "Bad token",
		});
	});

	it("returns legacy database properties directly", async () => {
		const properties = {
			Title: property("title"),
			Status: property("status"),
		};
		const client = new NotionClient("secret-token", {
			fetcher: async () =>
				Response.json({ object: "database", id: databaseId, properties }),
		});

		await expect(client.schemaForDatabase(databaseId)).resolves.toEqual(
			properties,
		);
	});

	it("retrieves the only data source for a current database response", async () => {
		const paths: string[] = [];
		const properties = {
			Title: property("title"),
			Status: property("status"),
		};
		const client = new NotionClient("secret-token", {
			fetcher: async (input) => {
				const url = new URL(input.toString());
				paths.push(url.pathname);

				if (url.pathname === `/v1/databases/${databaseId}`) {
					return Response.json({
						object: "database",
						id: databaseId,
						data_sources: [{ id: dataSourceId, name: "Blog posts" }],
					});
				}

				return Response.json({
					object: "data_source",
					id: dataSourceId,
					properties,
				});
			},
		});

		await expect(client.schemaForDatabase(databaseId)).resolves.toEqual(
			properties,
		);
		expect(paths).toEqual([
			`/v1/databases/${databaseId}`,
			`/v1/data_sources/${dataSourceId}`,
		]);
	});

	it("uses the first data source explicitly when a database has multiple data sources", async () => {
		const paths: string[] = [];
		const firstDataSourceId = "11111111111111111111111111111111";
		const secondDataSourceId = "22222222222222222222222222222222";
		const properties = {
			Title: property("title"),
			Status: property("status"),
		};
		const client = new NotionClient("secret-token", {
			fetcher: async (input) => {
				const url = new URL(input.toString());
				paths.push(url.pathname);

				if (url.pathname === `/v1/databases/${databaseId}`) {
					return Response.json({
						object: "database",
						id: databaseId,
						data_sources: [
							{ id: firstDataSourceId, name: "Primary" },
							{ id: secondDataSourceId, name: "Archive" },
						],
					});
				}

				return Response.json({
					object: "data_source",
					id: firstDataSourceId,
					properties,
				});
			},
		});

		await expect(client.schemaForDatabase(databaseId)).resolves.toEqual(
			properties,
		);
		expect(paths).toEqual([
			`/v1/databases/${databaseId}`,
			`/v1/data_sources/${firstDataSourceId}`,
		]);
	});
});

function property(type: string): { type: string } {
	return { type };
}
