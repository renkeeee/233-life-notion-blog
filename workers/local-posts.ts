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
	const slug = optionalNullableString(input.slug);

	if (slug !== null && !slugPattern.test(slug)) {
		throw new Error(slugValidationMessage);
	}

	return {
		title,
		slug,
		excerpt: optionalDefaultString(input.excerpt),
		markdown: optionalDefaultString(input.markdown),
		coverUrl: optionalNullableString(input.coverUrl),
		category: optionalNullableString(input.category),
		tags: normalizeTags(input.tags),
		commentsEnabled:
			typeof input.commentsEnabled === "boolean" ? input.commentsEnabled : null,
		publishedAt: optionalNullableString(input.publishedAt),
	};
}

export function validateLocalPublishInput(
	input: LocalDraftInput,
): ValidLocalDraftInput {
	const draft = validateLocalDraftInput(input);

	if (draft.slug === null) {
		throw new Error("Slug is required");
	}

	if (draft.markdown.length === 0) {
		throw new Error("Markdown is required");
	}

	return draft;
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

function optionalNullableString(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}

	const trimmed = value.trim();
	return trimmed.length === 0 ? null : trimmed;
}

function optionalDefaultString(value: unknown): string {
	if (typeof value !== "string") {
		return "";
	}

	return value.trim();
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
