import type { AppEnv } from "./types";

export type LocalDraftStatus = "draft" | "published" | "archived";

export interface LocalDraftInput {
	title: unknown;
	slug?: unknown;
	excerpt?: unknown;
	markdown?: unknown;
	coverUrl?: unknown;
	category?: unknown;
	tags?: unknown;
	commentsEnabled?: unknown;
	publishedAt?: unknown;
}

export interface ValidLocalDraftInput {
	title: string;
	slug: string | null;
	excerpt: string;
	markdown: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	commentsEnabled: boolean | null;
	publishedAt: string | null;
}

export interface LocalDraftRecord {
	id: string;
	postId: string | null;
	title: string;
	slug: string | null;
	excerpt: string;
	markdown: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	status: LocalDraftStatus;
	commentsEnabled: boolean | null;
	publishedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

type LocalDraftRow = {
	id: string;
	post_id: string | null;
	title: string;
	slug: string | null;
	excerpt: string | null;
	markdown: string;
	cover_url: string | null;
	category: string | null;
	tags_json: string;
	status: LocalDraftStatus;
	comments_enabled: number | null;
	published_at: string | null;
	created_at: string;
	updated_at: string;
};

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slugValidationMessage =
	"Slug must contain only lowercase letters, numbers, and hyphens";

export function normalizeLocalPostSlug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");
}

export function validateLocalDraftInput(
	input: LocalDraftInput,
): ValidLocalDraftInput {
	const title = requiredString(input.title, "Title");
	const slug = optionalSlug(input.slug);

	if (slug !== null && !slugPattern.test(slug)) {
		throw new Error(slugValidationMessage);
	}

	return {
		title,
		slug,
		excerpt: optionalDefaultString(input.excerpt, "Excerpt"),
		markdown: optionalMarkdown(input.markdown),
		coverUrl: optionalNullableString(input.coverUrl, "Cover URL"),
		category: optionalNullableString(input.category, "Category"),
		tags: normalizeTags(input.tags),
		commentsEnabled: optionalBoolean(input.commentsEnabled, "Comments enabled"),
		publishedAt: optionalNullableString(input.publishedAt, "Published date"),
	};
}

export function validateLocalPublishInput(
	input: LocalDraftInput,
): ValidLocalDraftInput {
	const draft = validateLocalDraftInput(input);

	if (draft.slug === null) {
		throw new Error("Slug is required");
	}

	if (draft.markdown.trim().length === 0) {
		throw new Error("Markdown is required");
	}

	return draft;
}

export function parseTagsJson(value: string): string[] {
	try {
		const parsed = JSON.parse(value) as unknown;

		if (!Array.isArray(parsed)) {
			return [];
		}

		return parsed.filter((tag): tag is string => typeof tag === "string");
	} catch {
		return [];
	}
}

function mapDraftRow(row: LocalDraftRow): LocalDraftRecord {
	return {
		id: row.id,
		postId: row.post_id,
		title: row.title,
		slug: row.slug,
		excerpt: row.excerpt ?? "",
		markdown: row.markdown,
		coverUrl: row.cover_url,
		category: row.category,
		tags: parseTagsJson(row.tags_json),
		status: row.status,
		commentsEnabled:
			row.comments_enabled === null ? null : row.comments_enabled === 1,
		publishedAt: row.published_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function createLocalDraft(
	env: AppEnv,
	input: LocalDraftInput,
	now = new Date().toISOString(),
): Promise<LocalDraftRecord> {
	const draft = validateLocalDraftInput(input);
	const id = crypto.randomUUID();

	await env.DB.prepare(
		`INSERT INTO post_drafts (
			id, post_id, title, slug, excerpt, markdown, cover_url, category,
			tags_json, status, comments_enabled, published_at, created_at, updated_at
		)
		VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
	)
		.bind(
			id,
			draft.title,
			draft.slug,
			draft.excerpt,
			draft.markdown,
			draft.coverUrl,
			draft.category,
			JSON.stringify(draft.tags),
			draft.commentsEnabled === null ? null : draft.commentsEnabled ? 1 : 0,
			draft.publishedAt,
			now,
			now,
		)
		.run();

	const created = await getLocalDraft(env, id);
	if (!created) {
		throw new Error("Local draft could not be loaded");
	}

	return created;
}

export async function getLocalDraft(
	env: AppEnv,
	id: string,
): Promise<LocalDraftRecord | null> {
	const row = await env.DB.prepare(
		`SELECT
			id, post_id, title, slug, excerpt, markdown, cover_url, category,
			tags_json, status, comments_enabled, published_at, created_at, updated_at
		 FROM post_drafts
		 WHERE id = ?`,
	)
		.bind(id)
		.first<LocalDraftRow>();

	return row ? mapDraftRow(row) : null;
}

export async function updateLocalDraft(
	env: AppEnv,
	id: string,
	input: LocalDraftInput,
	now = new Date().toISOString(),
): Promise<LocalDraftRecord | null> {
	const draft = validateLocalDraftInput(input);
	const existing = await getLocalDraft(env, id);

	if (!existing) {
		return null;
	}

	await env.DB.prepare(
		`UPDATE post_drafts
		 SET title = ?,
			 slug = ?,
			 excerpt = ?,
			 markdown = ?,
			 cover_url = ?,
			 category = ?,
			 tags_json = ?,
			 comments_enabled = ?,
			 published_at = ?,
			 updated_at = ?
		 WHERE id = ?`,
	)
		.bind(
			draft.title,
			draft.slug,
			draft.excerpt,
			draft.markdown,
			draft.coverUrl,
			draft.category,
			JSON.stringify(draft.tags),
			draft.commentsEnabled === null ? null : draft.commentsEnabled ? 1 : 0,
			draft.publishedAt,
			now,
			id,
		)
		.run();

	return getLocalDraft(env, id);
}

export function localDraftResponse(draft: LocalDraftRecord) {
	return {
		id: draft.id,
		postId: draft.postId,
		title: draft.title,
		slug: draft.slug,
		excerpt: draft.excerpt,
		markdown: draft.markdown,
		coverUrl: draft.coverUrl,
		category: draft.category,
		tags: draft.tags,
		status: draft.status,
		commentsEnabled: draft.commentsEnabled,
		publishedAt: draft.publishedAt,
		createdAt: draft.createdAt,
		updatedAt: draft.updatedAt,
	};
}

export function extractMarkdownImageUrls(markdown: string): string[] {
	const urls: string[] = [];
	const imagePattern = /!\[[^\]\n]*(?:\][^\[\]\n]*)*]\(([^)]*)\)/g;
	let match: RegExpExecArray | null;

	while ((match = imagePattern.exec(markdown)) !== null) {
		const destination = parseMarkdownLinkDestination(match[1]);

		if (destination !== null) {
			urls.push(destination);
		}
	}

	return urls;
}

function requiredString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} is required`);
	}

	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new Error(`${label} is required`);
	}

	return trimmed;
}

function optionalNullableString(
	value: unknown,
	label: string,
): string | null {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value !== "string") {
		throw new Error(`${label} must be a string`);
	}

	const trimmed = value.trim();
	return trimmed.length === 0 ? null : trimmed;
}

function optionalSlug(value: unknown): string | null {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value !== "string") {
		throw new Error("Slug must be a string");
	}

	return value.trim().length === 0 ? null : value;
}

function optionalDefaultString(value: unknown, label: string): string {
	if (value === undefined || value === null) {
		return "";
	}

	if (typeof value !== "string") {
		throw new Error(`${label} must be a string`);
	}

	return value.trim();
}

function optionalMarkdown(value: unknown): string {
	if (value === undefined || value === null) {
		return "";
	}

	if (typeof value !== "string") {
		throw new Error("Markdown must be a string");
	}

	return value;
}

function optionalBoolean(value: unknown, label: string): boolean | null {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value !== "boolean") {
		throw new Error(`${label} must be a boolean`);
	}

	return value;
}

function normalizeTags(value: unknown): string[] {
	if (value === undefined || value === null) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new Error("Tags must be an array");
	}

	const tags: string[] = [];
	const seen = new Set<string>();

	for (const tag of value) {
		if (typeof tag !== "string") {
			throw new Error("Tags must contain only strings");
		}

		const trimmed = tag.trim();
		if (trimmed.length === 0 || seen.has(trimmed)) {
			continue;
		}

		seen.add(trimmed);
		tags.push(trimmed);
	}

	return tags;
}

function parseMarkdownLinkDestination(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return null;
	}

	if (trimmed.startsWith("<")) {
		const closingIndex = trimmed.indexOf(">");
		return closingIndex > 1 ? trimmed.slice(1, closingIndex) : null;
	}

	const destination = trimmed.split(/\s+/, 1)[0];
	return destination.length > 0 ? destination : null;
}
