import type { NotionProperties } from "./database";
import type { NotionBlock } from "./blocks";

const NOTION_API_BASE_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";

export type NotionFetcher = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export class NotionApiError extends Error {
	readonly status: number;
	readonly code?: string;

	constructor(message: string, status: number, code?: string) {
		super(message);
		this.name = "NotionApiError";
		this.status = status;
		this.code = code;
	}
}

export interface NotionClientOptions {
	fetcher?: NotionFetcher;
	baseUrl?: string;
}

export interface SchemaForDatabaseOptions {
	dataSourceId?: string;
}

export interface NotionDatabase {
	object?: "database";
	id: string;
	properties?: NotionProperties;
	data_sources?: NotionDataSourceReference[];
}

export interface NotionDataSource {
	object?: "data_source";
	id: string;
	properties: NotionProperties;
}

export interface NotionDataSourceReference {
	id: string;
	name?: string;
}

export interface NotionListResponse<T> {
	results?: T[];
	has_more?: boolean;
	next_cursor?: string | null;
}

export class NotionClient {
	private readonly token: string;
	private readonly fetcher: NotionFetcher;
	private readonly baseUrl: string;

	constructor(token: string, options: NotionClientOptions = {}) {
		this.token = token;
		this.fetcher = options.fetcher ?? fetch;
		this.baseUrl = (options.baseUrl ?? NOTION_API_BASE_URL).replace(/\/+$/, "");
	}

	async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await this.fetcher(this.urlFor(path), {
			...init,
			headers: this.headersFor(init),
		});

		if (!response.ok) {
			throw await notionApiError(response);
		}

		return (await response.json()) as T;
	}

	retrieveDatabase(databaseId: string): Promise<NotionDatabase> {
		return this.request<NotionDatabase>(`/databases/${databaseId}`);
	}

	retrieveDataSource(dataSourceId: string): Promise<NotionDataSource> {
		return this.request<NotionDataSource>(`/data_sources/${dataSourceId}`);
	}

	async schemaForDatabase(
		databaseId: string,
		options: SchemaForDatabaseOptions = {},
	): Promise<NotionProperties> {
		const database = await this.retrieveDatabase(databaseId);

		if (database.properties) {
			return database.properties;
		}

		if (options.dataSourceId) {
			return this.schemaForDataSource(options.dataSourceId);
		}

		const dataSources = database.data_sources ?? [];
		if (dataSources.length === 0) {
			throw new Error("FIELD_MAPPING_INVALID: Notion database has no data sources");
		}

		if (dataSources.length > 1) {
			throw new Error(
				"NOTION_DATA_SOURCE_AMBIGUOUS: Notion database has multiple data sources; configure dataSourceId",
			);
		}

		return this.schemaForDataSource(dataSources[0].id);
	}

	async schemaForDataSource(dataSourceId: string): Promise<NotionProperties> {
		return (await this.retrieveDataSource(dataSourceId)).properties;
	}

	async queryDatabaseOrDataSourcePages<T = Record<string, unknown>>(
		databaseId: string,
		body: Record<string, unknown> = {},
	): Promise<T[]> {
		return this.paginatedPost<T>(
			await this.queryPathForDatabase(databaseId),
			body,
		);
	}

	async listBlockTree(blockId: string): Promise<NotionBlock[]> {
		const blocks = await this.paginatedGet<NotionBlock>(
			`/blocks/${blockId}/children`,
		);

		for (const block of blocks) {
			if (block.has_children === true && typeof block.id === "string") {
				block.children = await this.listBlockTree(block.id);
			}
		}

		return blocks;
	}

	private async queryPathForDatabase(databaseId: string): Promise<string> {
		const database = await this.retrieveDatabase(databaseId);

		if (database.properties) {
			return `/databases/${databaseId}/query`;
		}

		const dataSources = database.data_sources ?? [];
		if (dataSources.length === 0) {
			throw new Error("FIELD_MAPPING_INVALID: Notion database has no data sources");
		}

		if (dataSources.length > 1) {
			throw new Error(
				"NOTION_DATA_SOURCE_AMBIGUOUS: Notion database has multiple data sources; configure dataSourceId",
			);
		}

		return `/data_sources/${dataSources[0].id}/query`;
	}

	private async paginatedPost<T>(
		path: string,
		body: Record<string, unknown>,
	): Promise<T[]> {
		const results: T[] = [];
		let startCursor: string | undefined;

		do {
			const response = await this.request<NotionListResponse<T>>(path, {
				method: "POST",
				body: JSON.stringify({
					...body,
					page_size: body.page_size ?? 100,
					...(startCursor ? { start_cursor: startCursor } : {}),
				}),
			});

			results.push(...(response.results ?? []));
			startCursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
		} while (startCursor);

		return results;
	}

	private async paginatedGet<T>(path: string): Promise<T[]> {
		const results: T[] = [];
		let startCursor: string | undefined;

		do {
			const params = new URLSearchParams({ page_size: "100" });
			if (startCursor) {
				params.set("start_cursor", startCursor);
			}
			const response = await this.request<NotionListResponse<T>>(
				`${path}?${params}`,
			);

			results.push(...(response.results ?? []));
			startCursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
		} while (startCursor);

		return results;
	}

	private urlFor(path: string): string {
		const normalizedPath = path.startsWith("/") ? path : `/${path}`;
		return `${this.baseUrl}${normalizedPath}`;
	}

	private headersFor(init: RequestInit): Headers {
		const nextHeaders = new Headers(init.headers);
		nextHeaders.set("Authorization", `Bearer ${this.token}`);
		nextHeaders.set("Notion-Version", NOTION_VERSION);
		if (!nextHeaders.has("Accept")) {
			nextHeaders.set("Accept", "application/json");
		}
		if (init.body != null && !nextHeaders.has("Content-Type")) {
			nextHeaders.set("Content-Type", "application/json");
		}
		return nextHeaders;
	}
}

async function notionApiError(response: Response): Promise<NotionApiError> {
	const payload = await readErrorPayload(response);
	const code =
		isRecord(payload) && typeof payload.code === "string"
			? payload.code
			: undefined;
	const message =
		isRecord(payload) && typeof payload.message === "string"
			? payload.message
			: `Notion API request failed with status ${response.status}`;

	return new NotionApiError(message, response.status, code);
}

async function readErrorPayload(response: Response): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		return null;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
