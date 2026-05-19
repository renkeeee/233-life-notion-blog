import { DEFAULT_PUBLISHED_STATUS_VALUES, type FieldMapping } from "../types";

export interface NotionPropertySchema {
	type?: string;
	name?: string;
	[key: string]: unknown;
}

export type NotionProperties = Record<string, NotionPropertySchema>;

export function parseNotionDatabaseId(input: string): string {
	const directId = normalizeDatabaseId(input);
	if (directId) {
		return directId;
	}

	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw invalidDatabaseId();
	}

	if (!isNotionHostname(url.hostname)) {
		throw invalidDatabaseId();
	}

	let matches: string[];
	try {
		matches = url.pathname
			.split("/")
			.filter(Boolean)
			.map((segment) => databaseIdFromPathSegment(decodeURIComponent(segment)))
			.filter((id): id is string => id !== null);
	} catch {
		throw invalidDatabaseId();
	}

	if (matches.length !== 1) {
		throw invalidDatabaseId();
	}

	return matches[0];
}

export function inferFieldMapping(properties: NotionProperties): FieldMapping {
	const entries = Object.entries(properties);
	const used = new Set<string>();
	const title = findProperty(entries, {
		types: ["title"],
	});

	if (title) {
		used.add(title);
	}

	const status = findProperty(entries, {
		aliases: ["status", "publish", "published", "visibility", "状态", "发布"],
		types: ["status", "select", "checkbox"],
	}, used);

	if (!title || !status) {
		throw new Error("FIELD_MAPPING_INVALID: title and status fields are required");
	}

	used.add(status);

	const mapping: FieldMapping = {
		title,
		status,
		publishedStatusValues: [...DEFAULT_PUBLISHED_STATUS_VALUES],
	};

	const publishedAt = findProperty(entries, {
		aliases: ["date", "published_at", "published", "created", "日期", "发布日期"],
		types: ["date", "created_time"],
	}, used);
	if (publishedAt) {
		mapping.publishedAt = publishedAt;
		used.add(publishedAt);
	}

	return mapping;
}

export function isPublishedStatus(
	value: unknown,
	publishedStatusValues: readonly string[] = DEFAULT_PUBLISHED_STATUS_VALUES,
): boolean {
	return (
		value === true ||
		(typeof value === "string" && publishedStatusValues.includes(value))
	);
}

function normalizeDatabaseId(input: string): string | null {
	if (/^[0-9a-fA-F]{32}$/.test(input)) {
		return input.toLowerCase();
	}

	if (
		/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
			input,
		)
	) {
		return input.replaceAll("-", "").toLowerCase();
	}

	return null;
}

function databaseIdFromPathSegment(segment: string): string | null {
	const directId = normalizeDatabaseId(segment);
	if (directId) {
		return directId;
	}

	const compactSlugMatch = /(?:^|[-_])([0-9a-fA-F]{32})$/.exec(segment);
	if (compactSlugMatch?.[1]) {
		return normalizeDatabaseId(compactSlugMatch[1]);
	}

	const dashedSlugMatch =
		/(?:^|[-_])([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/.exec(
			segment,
		);
	if (dashedSlugMatch?.[1]) {
		return normalizeDatabaseId(dashedSlugMatch[1]);
	}

	return null;
}

function isNotionHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return (
		normalized === "notion.so" ||
		normalized.endsWith(".notion.so") ||
		normalized === "notion.site" ||
		normalized.endsWith(".notion.site")
	);
}

function invalidDatabaseId(): Error {
	return new Error("Invalid Notion database URL or id");
}

type PropertyEntry = [name: string, schema: NotionPropertySchema];

interface PropertyMatchOptions {
	aliases?: string[];
	types: string[];
}

function findProperty(
	entries: PropertyEntry[],
	options: PropertyMatchOptions,
	used = new Set<string>(),
): string | undefined {
	let best: { name: string; score: number } | undefined;

	for (const [name, schema] of entries) {
		if (used.has(name) || !options.types.includes(schema.type ?? "")) {
			continue;
		}

		if (!options.aliases) {
			return name;
		}

		const score = aliasScore(name, options.aliases);
		if (score === 0) {
			continue;
		}

		if (!best || score > best.score) {
			best = { name, score };
		}
	}

	return best?.name;
}

function aliasScore(name: string, aliases: string[]): number {
	const normalizedName = normalizePropertyName(name);
	const nameTokens = tokenizePropertyName(name);
	let score = 0;

	for (const alias of aliases) {
		const normalizedAlias = normalizePropertyName(alias);
		if (normalizedName === normalizedAlias) {
			score = Math.max(score, 100 + normalizedAlias.length);
			continue;
		}

		if (containsCjk(normalizedAlias) && normalizedName.includes(normalizedAlias)) {
			score = Math.max(score, 80 + normalizedAlias.length);
			continue;
		}

		const aliasTokens = tokenizePropertyName(alias);
		if (hasTokenSequence(nameTokens, aliasTokens)) {
			score = Math.max(score, 70 + aliasTokens.length);
		}
	}

	return score;
}

function normalizePropertyName(name: string): string {
	return tokenizePropertyName(name).join("");
}

function tokenizePropertyName(name: string): string[] {
	return name
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[\s_-]+/g)
		.filter(Boolean);
}

function hasTokenSequence(nameTokens: string[], aliasTokens: string[]): boolean {
	if (aliasTokens.length === 0 || aliasTokens.length > nameTokens.length) {
		return false;
	}

	for (let index = 0; index <= nameTokens.length - aliasTokens.length; index += 1) {
		if (
			aliasTokens.every(
				(aliasToken, aliasIndex) => nameTokens[index + aliasIndex] === aliasToken,
			)
		) {
			return true;
		}
	}

	return false;
}

function containsCjk(value: string): boolean {
	return /[\u3400-\u9fff]/.test(value);
}
