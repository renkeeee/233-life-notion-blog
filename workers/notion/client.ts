import type { NotionProperties } from "./database";

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

export class NotionClient {
	private readonly token: string;
	private readonly fetcher: NotionFetcher;
	private readonly baseUrl: string;

	constructor(token: string, options: NotionClientOptions = {}) {
		this.token = token;
		this.fetcher = options.fetcher ?? fetch;
		this.baseUrl = options.baseUrl ?? NOTION_API_BASE_URL;
	}

	async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await this.fetcher(this.urlFor(path), {
			...init,
			headers: this.headersFor(init.headers),
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

	async schemaForDatabase(databaseId: string): Promise<NotionProperties> {
		const database = await this.retrieveDatabase(databaseId);

		if (database.properties) {
			return database.properties;
		}

		const [dataSource] = database.data_sources ?? [];
		if (!dataSource) {
			throw new Error("FIELD_MAPPING_INVALID: Notion database has no data sources");
		}

		// The current API can return several data sources for one database. A
		// configured database URL has no source selector, so the first source is
		// the only deterministic fallback until configuration stores a source id.
		return (await this.retrieveDataSource(dataSource.id)).properties;
	}

	private urlFor(path: string): string {
		const normalizedPath = path.startsWith("/") ? path : `/${path}`;
		return `${this.baseUrl}${normalizedPath}`;
	}

	private headersFor(headers: HeadersInit | undefined): Headers {
		const nextHeaders = new Headers(headers);
		nextHeaders.set("Authorization", `Bearer ${this.token}`);
		nextHeaders.set("Notion-Version", NOTION_VERSION);
		nextHeaders.set("Accept", "application/json");
		nextHeaders.set("Content-Type", "application/json");
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
