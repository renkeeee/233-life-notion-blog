import type { FieldMapping } from "../types";

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
			.map((segment) => normalizeDatabaseId(decodeURIComponent(segment)))
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
	const title = findProperty(entries, {
		types: ["title"],
	});

	const status = findProperty(entries, {
		aliases: ["status", "publish", "published", "状态"],
		types: ["status", "select", "checkbox"],
	});

	if (!title || !status) {
		throw new Error("FIELD_MAPPING_INVALID: title and status fields are required");
	}

	const mapping: FieldMapping = {
		title,
		status,
	};

	const slug = findProperty(entries, {
		aliases: ["slug", "url", "name"],
		exclude: [title],
		types: ["rich_text", "url", "formula", "select"],
	});
	if (slug) {
		mapping.slug = slug;
	}

	const summary = findProperty(entries, {
		aliases: ["summary", "description", "excerpt", "摘要"],
		types: ["rich_text", "text", "url"],
	});
	if (summary) {
		mapping.summary = summary;
	}

	const tags = findProperty(entries, {
		aliases: ["tags", "tag", "标签"],
		types: ["multi_select", "select"],
	});
	if (tags) {
		mapping.tags = tags;
	}

	const publishedAt = findProperty(entries, {
		aliases: ["date", "published_at", "published", "发布日期"],
		types: ["date", "created_time"],
	});
	if (publishedAt) {
		mapping.publishedAt = publishedAt;
	}

	const cover = findProperty(entries, {
		aliases: ["cover", "封面"],
		types: ["files", "url"],
	});
	if (cover) {
		mapping.cover = cover;
	}

	return mapping;
}

export function isPublishedStatus(value: unknown): boolean {
	return value === true || value === "Published" || value === "已发布";
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
	exclude?: string[];
	types: string[];
}

function findProperty(
	entries: PropertyEntry[],
	options: PropertyMatchOptions,
): string | undefined {
	const excluded = new Set(options.exclude ?? []);

	for (const [name, schema] of entries) {
		if (excluded.has(name) || !options.types.includes(schema.type ?? "")) {
			continue;
		}

		if (!options.aliases || matchesAnyAlias(name, options.aliases)) {
			return name;
		}
	}

	return undefined;
}

function matchesAnyAlias(name: string, aliases: string[]): boolean {
	const normalizedName = normalizePropertyName(name);
	return aliases.some((alias) => normalizedName.includes(normalizePropertyName(alias)));
}

function normalizePropertyName(name: string): string {
	return name.toLowerCase().replace(/[\s_-]+/g, "");
}
