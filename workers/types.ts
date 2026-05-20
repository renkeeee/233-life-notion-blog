export interface AppEnv {
	DB: D1Database;
	BLOG_ASSETS: R2Bucket;
	CONFIG_ENCRYPTION_KEY: string;
	TURNSTILE_SITE_KEY?: string;
	TURNSTILE_SECRET_KEY?: string;
	TURNSTILE_SITEVERIFY_URL?: string;
	VALUE_FROM_CLOUDFLARE?: string;
}

export type PostVisibility = "published" | "hidden" | "archived";

export interface PublicPostRecord {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	status: string;
	visibility: PostVisibility;
	locked?: boolean;
	commentsEnabled?: boolean;
	comments?: PublicPostComment[];
	publishedAt: string | null;
	updatedAt: string;
}

export interface PublicPostComment {
	id: string;
	nickname: string;
	body: string;
	createdAt: string;
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
	category?: string;
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
