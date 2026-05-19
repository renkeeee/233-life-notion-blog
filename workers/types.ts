export interface AppEnv {
	DB: D1Database;
	BLOG_ASSETS: R2Bucket;
	CONFIG_ENCRYPTION_KEY: string;
	VALUE_FROM_CLOUDFLARE?: string;
}

export type PostVisibility = "published" | "hidden" | "archived";

export interface PublicPostRecord {
	id: string;
	slug: string;
	title: string;
	coverUrl: string | null;
	tags: string[];
	status: string;
	visibility: PostVisibility;
	publishedAt: string | null;
	updatedAt: string;
}

export type ApiErrorCode =
	| "BAD_REQUEST"
	| "UNAUTHORIZED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "NOTION_AUTH_FAILED"
	| "NOTION_DATABASE_NOT_FOUND"
	| "FIELD_MAPPING_INVALID"
	| "NOTION_RATE_LIMITED"
	| "ASSET_DOWNLOAD_FAILED"
	| "R2_UPLOAD_FAILED"
	| "CONFIG_DECRYPT_FAILED"
	| "INTERNAL_ERROR"
	| "SYNC_ALREADY_RUNNING";

export interface ApiErrorBody {
	error: {
		code: ApiErrorCode;
		message: string;
	};
}

export interface FieldMapping {
	title: string;
	status: string;
	tags?: string;
	publishedAt?: string;
	publishedStatusValues?: string[];
}

export interface SiteSettings {
	siteTitle: string;
	notionDatabaseUrl: string;
	notionDatabaseId: string;
	notionToken: string;
	cdnBaseUrl: string;
	fieldMapping: FieldMapping;
}

export const DEFAULT_PUBLISHED_STATUS_VALUES = ["Published", "已发布"] as const;
