import { describe, expect, it, vi } from "vitest";
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
			status: "Status",
			tags: "Tags",
			publishedAt: "Published At",
			publishedStatusValues: ["Published", "已发布"],
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
			status: "published-status",
			publishedAt: "Published_Date",
			publishedStatusValues: ["Published", "已发布"],
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
			status: "状态",
			tags: "标签",
			publishedAt: "发布日期",
			publishedStatusValues: ["Published", "已发布"],
		});
	});

	it("does not map Notion properties for locally generated slugs", () => {
		const mapping = inferFieldMapping({
			Name: property("title"),
			Published: property("checkbox"),
			Slug: property("rich_text"),
		});

		expect(mapping).toEqual({
			title: "Name",
			status: "Published",
			publishedStatusValues: ["Published", "已发布"],
		});
	});

	it("does not match aliases as substrings inside unrelated words", () => {
		expect(() =>
			inferFieldMapping({
				Title: property("title"),
				Publisher: property("select"),
			}),
		).toThrow("FIELD_MAPPING_INVALID");

		expect(
			inferFieldMapping({
				Title: property("title"),
				Status: property("status"),
				Username: property("rich_text"),
				Updated: property("date"),
				Staging: property("multi_select"),
			}),
		).toEqual({
			title: "Title",
			status: "Status",
			publishedStatusValues: ["Published", "已发布"],
		});
	});

	it("does not reuse one Notion property for multiple mapped fields", () => {
		expect(
			inferFieldMapping({
				Title: property("title"),
				Status: property("status"),
				"Cover URL": property("url"),
			}),
		).toEqual({
			title: "Title",
			status: "Status",
			publishedStatusValues: ["Published", "已发布"],
		});

		expect(
			inferFieldMapping({
				Title: property("title"),
				"Status Tags": property("select"),
			}),
		).toEqual({
			title: "Title",
			status: "Status Tags",
			publishedStatusValues: ["Published", "已发布"],
		});

		expect(
			inferFieldMapping({
				Title: property("title"),
				Status: property("status"),
				"Status Tags": property("select"),
			}),
		).toEqual({
			title: "Title",
			status: "Status",
			tags: "Status Tags",
			publishedStatusValues: ["Published", "已发布"],
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
		expect(requests[0].headers.get("Content-Type")).toBeNull();
	});

	it("normalizes trailing slashes in the configured base URL", async () => {
		const requests: Request[] = [];
		const client = new NotionClient("secret-token", {
			baseUrl: "https://api.notion.com/v1/",
			fetcher: async (input, init) => {
				requests.push(new Request(input, init));
				return Response.json({ object: "database", id: databaseId, properties: {} });
			},
		});

		await client.retrieveDatabase(databaseId);

		expect(requests[0].url).toBe(
			`https://api.notion.com/v1/databases/${databaseId}`,
		);
	});

	it("preserves caller content negotiation headers when sending requests", async () => {
		const requests: Request[] = [];
		const client = new NotionClient("secret-token", {
			fetcher: async (input, init) => {
				requests.push(new Request(input, init));
				return Response.json({ ok: true });
			},
		});

		await client.request("/custom", {
			headers: {
				Accept: "application/x-ndjson",
				"Content-Type": "text/plain",
			},
			body: "plain text",
			method: "POST",
		});

		expect(requests[0].headers.get("Authorization")).toBe(
			"Bearer secret-token",
		);
		expect(requests[0].headers.get("Notion-Version")).toBe("2026-03-11");
		expect(requests[0].headers.get("Accept")).toBe("application/x-ndjson");
		expect(requests[0].headers.get("Content-Type")).toBe("text/plain");
	});

	it("sets content type automatically only for requests with a body", async () => {
		const requests: Request[] = [];
		const client = new NotionClient("secret-token", {
			fetcher: async (input, init) => {
				requests.push(new Request(input, init));
				return Response.json({ ok: true });
			},
		});

		await client.request("/without-body");
		await client.request("/with-body", { body: "{}", method: "POST" });

		expect(requests[0].headers.get("Content-Type")).toBeNull();
		expect(requests[0].headers.get("Accept")).toBe("application/json");
		expect(requests[1].headers.get("Content-Type")).toBe("application/json");
	});

	it("calls the default global fetch without rebinding this", async () => {
		const requests: Request[] = [];
		const fetcher = vi.fn(function (
			this: unknown,
			input: RequestInfo | URL,
			init?: RequestInit,
		) {
			if (this !== undefined) {
				throw new TypeError("Illegal invocation");
			}

			requests.push(new Request(input, init));
			return Promise.resolve(Response.json({ ok: true }));
		});
		vi.stubGlobal("fetch", fetcher);

		try {
			const client = new NotionClient("secret-token");
			await client.request("/default-fetch");

			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(requests[0]?.url).toBe(
				"https://api.notion.com/v1/default-fetch",
			);
		} finally {
			vi.unstubAllGlobals();
		}
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

	it("resolves a page link that contains one child database for schema testing", async () => {
		const paths: string[] = [];
		const pageId = "3646b3023c2380fc886af37685393dd4";
		const childDatabaseId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const properties = {
			Title: property("title"),
			Status: property("status"),
		};
		const client = new NotionClient("secret-token", {
			fetcher: async (input) => {
				const url = new URL(input.toString());
				paths.push(url.pathname);

				if (url.pathname === `/v1/databases/${pageId}`) {
					return Response.json(
						{
							object: "error",
							code: "validation_error",
							message: `Provided database_id ${pageId} is a page, not a database.`,
						},
						{ status: 400 },
					);
				}

				if (url.pathname === `/v1/blocks/${pageId}/children`) {
					return Response.json({
						object: "list",
						has_more: false,
						next_cursor: null,
						results: [
							{
								object: "block",
								id: childDatabaseId,
								type: "child_database",
								child_database: { title: "Posts" },
							},
						],
					});
				}

				if (url.pathname === `/v1/databases/${childDatabaseId}`) {
					return Response.json({
						object: "database",
						id: childDatabaseId,
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

		await expect(client.schemaForDatabase(pageId)).resolves.toEqual(properties);
		expect(paths).toEqual([
			`/v1/databases/${pageId}`,
			`/v1/blocks/${pageId}/children`,
			`/v1/databases/${childDatabaseId}`,
			`/v1/data_sources/${dataSourceId}`,
		]);
	});

	it("throws a clear error when a database has multiple data sources without a selected source", async () => {
		const paths: string[] = [];
		const firstDataSourceId = "11111111111111111111111111111111";
		const secondDataSourceId = "22222222222222222222222222222222";
		const client = new NotionClient("secret-token", {
			fetcher: async (input) => {
				const url = new URL(input.toString());
				paths.push(url.pathname);

				return Response.json({
					object: "database",
					id: databaseId,
					data_sources: [
						{ id: firstDataSourceId, name: "Primary" },
						{ id: secondDataSourceId, name: "Archive" },
					],
				});
			},
		});

		await expect(client.schemaForDatabase(databaseId)).rejects.toThrow(
			"NOTION_DATA_SOURCE_AMBIGUOUS",
		);
		expect(paths).toEqual([`/v1/databases/${databaseId}`]);
	});

	it("retrieves a selected data source when a database has multiple data sources", async () => {
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
					id: secondDataSourceId,
					properties,
				});
			},
		});

		await expect(
			client.schemaForDatabase(databaseId, { dataSourceId: secondDataSourceId }),
		).resolves.toEqual(properties);
		expect(paths).toEqual([
			`/v1/databases/${databaseId}`,
			`/v1/data_sources/${secondDataSourceId}`,
		]);
	});

	it("retrieves a data source schema directly", async () => {
		const paths: string[] = [];
		const properties = {
			Title: property("title"),
			Status: property("status"),
		};
		const client = new NotionClient("secret-token", {
			fetcher: async (input) => {
				const url = new URL(input.toString());
				paths.push(url.pathname);

				return Response.json({
					object: "data_source",
					id: dataSourceId,
					properties,
				});
			},
		});

		await expect(client.schemaForDataSource(dataSourceId)).resolves.toEqual(
			properties,
		);
		expect(paths).toEqual([`/v1/data_sources/${dataSourceId}`]);
	});

	it("queries the only data source for current database responses", async () => {
		const requests: Request[] = [];
		const client = new NotionClient("secret-token", {
			fetcher: async (input, init) => {
				const request = new Request(input, init);
				requests.push(request);
				const url = new URL(request.url);

				if (url.pathname === `/v1/databases/${databaseId}`) {
					return Response.json({
						object: "database",
						id: databaseId,
						data_sources: [{ id: dataSourceId, name: "Blog posts" }],
					});
				}

				return Response.json({
					object: "list",
					has_more: false,
					next_cursor: null,
					results: [{ object: "page", id: "page-1" }],
				});
			},
		});

		await expect(
			client.queryDatabaseOrDataSourcePages(databaseId, {
				filter: {
					timestamp: "last_edited_time",
					last_edited_time: { on_or_after: "2026-05-18T00:00:00.000Z" },
				},
			}),
		).resolves.toEqual([{ object: "page", id: "page-1" }]);
		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			`/v1/databases/${databaseId}`,
			`/v1/data_sources/${dataSourceId}/query`,
		]);
		await expect(requests[1].json()).resolves.toMatchObject({
			page_size: 100,
			filter: {
				timestamp: "last_edited_time",
			},
		});
	});

	it("queries pages from the child database when the configured id is a page", async () => {
		const requests: Request[] = [];
		const pageId = "3646b3023c2380fc886af37685393dd4";
		const childDatabaseId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const client = new NotionClient("secret-token", {
			fetcher: async (input, init) => {
				const request = new Request(input, init);
				requests.push(request);
				const url = new URL(request.url);

				if (url.pathname === `/v1/databases/${pageId}`) {
					return Response.json(
						{
							object: "error",
							code: "validation_error",
							message: `Provided database_id ${pageId} is a page, not a database.`,
						},
						{ status: 400 },
					);
				}

				if (url.pathname === `/v1/blocks/${pageId}/children`) {
					return Response.json({
						object: "list",
						has_more: false,
						next_cursor: null,
						results: [
							{
								object: "block",
								id: childDatabaseId,
								type: "child_database",
								child_database: { title: "Posts" },
							},
						],
					});
				}

				if (url.pathname === `/v1/databases/${childDatabaseId}`) {
					return Response.json({
						object: "database",
						id: childDatabaseId,
						data_sources: [{ id: dataSourceId, name: "Blog posts" }],
					});
				}

				return Response.json({
					object: "list",
					has_more: false,
					next_cursor: null,
					results: [{ object: "page", id: "page-1" }],
				});
			},
		});

		await expect(client.queryDatabaseOrDataSourcePages(pageId)).resolves.toEqual([
			{ object: "page", id: "page-1" },
		]);
		expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
			`/v1/databases/${pageId}`,
			`/v1/blocks/${pageId}/children`,
			`/v1/databases/${childDatabaseId}`,
			`/v1/data_sources/${dataSourceId}/query`,
		]);
	});

	it("paginates block children and attaches nested child blocks", async () => {
		const paths: string[] = [];
		const client = new NotionClient("secret-token", {
			fetcher: async (input) => {
				const url = new URL(input.toString());
				paths.push(`${url.pathname}?${url.searchParams}`);

				if (
					url.pathname === "/v1/blocks/root/children" &&
					url.searchParams.get("start_cursor") === "next-page"
				) {
					return Response.json({
						object: "list",
						has_more: false,
						next_cursor: null,
						results: [
							{
								id: "sibling",
								type: "paragraph",
								paragraph: { rich_text: [{ plain_text: "Sibling" }] },
							},
						],
					});
				}

				if (url.pathname === "/v1/blocks/root/children") {
					return Response.json({
						object: "list",
						has_more: true,
						next_cursor: "next-page",
						results: [
							{
								id: "child-with-children",
								type: "paragraph",
								has_children: true,
								paragraph: { rich_text: [{ plain_text: "Parent" }] },
							},
						],
					});
				}

				return Response.json({
					object: "list",
					has_more: false,
					next_cursor: null,
					results: [
						{
							id: "nested-child",
							type: "paragraph",
							paragraph: { rich_text: [{ plain_text: "Nested" }] },
						},
					],
				});
			},
		});

		await expect(client.listBlockTree("root")).resolves.toMatchObject([
			{
				id: "child-with-children",
				children: [{ id: "nested-child" }],
			},
			{ id: "sibling" },
		]);
		expect(paths).toEqual([
			"/v1/blocks/root/children?page_size=100",
			"/v1/blocks/root/children?page_size=100&start_cursor=next-page",
			"/v1/blocks/child-with-children/children?page_size=100",
		]);
	});
});

function property(type: string): { type: string } {
	return { type };
}
