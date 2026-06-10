export interface AppEnv {
	DB: D1Database;
	ASSETS?: {
		fetch(request: Request | URL | string): Promise<Response>;
	};
	BLOG_ASSETS: R2Bucket;
	CONFIG_ENCRYPTION_KEY: string;
	TURNSTILE_SITE_KEY?: string;
	TURNSTILE_SECRET_KEY?: string;
	TURNSTILE_SITEVERIFY_URL?: string;
	VALUE_FROM_CLOUDFLARE?: string;
}

export type PostVisibility = "published" | "hidden" | "archived";
export type PostSourceType = "notion" | "local";

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
	sourceType?: PostSourceType;
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
	replyBody?: string;
	replyCreatedAt?: string;
	createdAt: string;
}

export type PublicAlbumMediaKind = "image" | "video" | "audio" | "pdf" | "file";

export interface PublicAlbumMediaRecord {
	id: string;
	title: string;
	description: string;
	postId: string | null;
	postSlug: string | null;
	postTitle: string | null;
	category: string | null;
	tags: string[];
	kind: PublicAlbumMediaKind;
	url: string;
	thumbnailUrl?: string;
	largeUrl?: string;
	caption: string;
	takenAt: string | null;
	locationName: string;
	latitude: number | null;
	longitude: number | null;
	featured: boolean;
	collectionSlugs: string[];
	publishedAt: string | null;
	updatedAt: string;
}

export interface PublicAlbumCollectionRecord {
	id: string;
	slug: string;
	title: string;
	description: string;
	coverItemId: string | null;
	sortOrder: number;
}

export interface PublicAlbumList {
	items: PublicAlbumMediaRecord[];
	page: number;
	limit: number;
	hasMore: boolean;
	collections: PublicAlbumCollectionRecord[];
}

export type ApiErrorCode =
	| "BAD_REQUEST"
	| "UNAUTHORIZED"
	| "FORBIDDEN"
	| "RATE_LIMITED"
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
	albumPostMediaEnabled: boolean;
	fieldMapping: FieldMapping;
}

export const DEFAULT_PUBLISHED_STATUS_VALUES = ["Published", "已发布"] as const;
