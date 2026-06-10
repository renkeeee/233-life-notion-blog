import { decryptString, encryptString } from "./crypto";
import {
	DEFAULT_PUBLISHED_STATUS_VALUES,
	type FieldMapping,
	type SiteSettings,
} from "./types";

export interface SettingRow {
	key: string;
	value: string;
	encrypted: 0 | 1;
	updated_at: string;
}

export type RedactedSiteSettings = Omit<SiteSettings, "notionToken"> & {
	notionToken: "";
	hasNotionToken: boolean;
};

const sensitiveKeys = new Set<keyof SiteSettings>(["notionToken"]);
const requiredSettingKeys = [
	"siteTitle",
	"notionDatabaseUrl",
	"notionDatabaseId",
	"notionToken",
	"cdnBaseUrl",
	"fieldMapping",
	"albumPostMediaEnabled",
] as const satisfies readonly (keyof SiteSettings)[];
const optionalFieldMappingKeys = [
	"category",
	"tags",
	"publishedAt",
] as const satisfies readonly (keyof FieldMapping)[];
const defaultCategoryField = "Category";
const defaultTagsField = "Tags";
const requiredSettingKeySet = new Set<string>(requiredSettingKeys);

function assertNoUnknownSettingKeys(settings: Record<string, unknown>): void {
	for (const key of Object.keys(settings)) {
		if (!requiredSettingKeySet.has(key)) {
			throw new Error(`Unknown setting key: ${key}`);
		}
	}
}

function serializedSettingValue(
	key: (typeof requiredSettingKeys)[number],
	rawValue: unknown,
): string {
	if (typeof rawValue === "string") {
		if (rawValue.length === 0) {
			throw new Error(`Invalid setting: ${key}`);
		}

		return rawValue;
	}

	if (key === "fieldMapping" && isRecord(rawValue)) {
		return JSON.stringify(parseFieldMapping(JSON.stringify(rawValue)));
	}

	if (key === "albumPostMediaEnabled" && typeof rawValue === "boolean") {
		return rawValue ? "true" : "false";
	}

	if (key === "albumPostMediaEnabled" && rawValue === undefined) {
		return "true";
	}

	if (rawValue === undefined) {
		throw new Error(`Missing setting: ${key}`);
	}

	throw new Error(`Invalid setting: ${key}`);
}

export async function serializeSettingsForStorage(
	settings: SiteSettings,
	rootKey: string,
	now = new Date().toISOString(),
): Promise<SettingRow[]> {
	const rawSettings = settings as unknown as Record<string, unknown>;
	const rows: SettingRow[] = [];

	assertNoUnknownSettingKeys(rawSettings);

	for (const key of requiredSettingKeys) {
		const stringValue = serializedSettingValue(key, rawSettings[key]);
		const encrypted = sensitiveKeys.has(key) ? 1 : 0;

		rows.push({
			key,
			value: encrypted ? await encryptString(stringValue, rootKey) : stringValue,
			encrypted,
			updated_at: now,
		});
	}

	return rows;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFieldMapping(value: string): FieldMapping {
	let parsed: unknown;

	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error("Invalid setting: fieldMapping");
	}

	if (
		!isRecord(parsed) ||
		typeof parsed.title !== "string" ||
		parsed.title.length === 0 ||
		typeof parsed.status !== "string" ||
		parsed.status.length === 0
	) {
		throw new Error("Invalid setting: fieldMapping");
	}

	const fieldMapping: FieldMapping = {
		title: parsed.title,
		status: parsed.status,
		publishedStatusValues: parsePublishedStatusValues(
			parsed.publishedStatusValues,
		),
	};

	for (const key of optionalFieldMappingKeys) {
		const optionalValue = parsed[key];

		if (optionalValue === undefined) {
			continue;
		}

		if (typeof optionalValue !== "string") {
			throw new Error("Invalid setting: fieldMapping");
		}

		fieldMapping[key] = optionalValue;
	}

	if (!Object.prototype.hasOwnProperty.call(parsed, "tags")) {
		fieldMapping.tags = defaultTagsField;
	}

	if (!Object.prototype.hasOwnProperty.call(parsed, "category")) {
		fieldMapping.category = defaultCategoryField;
	}

	return fieldMapping;
}

function parsePublishedStatusValues(value: unknown): string[] {
	if (value === undefined) {
		return [...DEFAULT_PUBLISHED_STATUS_VALUES];
	}

	if (!Array.isArray(value)) {
		throw new Error("Invalid setting: fieldMapping");
	}

	const values = value.map((item) => {
		if (typeof item !== "string") {
			throw new Error("Invalid setting: fieldMapping");
		}

		return item.trim();
	});
	const uniqueValues = Array.from(new Set(values.filter(Boolean)));

	if (uniqueValues.length === 0) {
		throw new Error("Invalid setting: fieldMapping");
	}

	return uniqueValues;
}

async function rowValue(row: SettingRow, rootKey: string): Promise<string> {
	if (row.encrypted !== 0 && row.encrypted !== 1) {
		throw new Error(`Invalid setting: ${row.key}`);
	}

	return row.encrypted === 1 ? decryptString(row.value, rootKey) : row.value;
}

function requiredValue(
	values: Map<string, string>,
	key: (typeof requiredSettingKeys)[number],
): string {
	const value = values.get(key);

	if (value === undefined) {
		throw new Error(`Missing setting: ${key}`);
	}

	if (value.length === 0) {
		throw new Error(`Invalid setting: ${key}`);
	}

	return value;
}

export async function parseSettingsFromRows(
	rows: SettingRow[],
	rootKey: string,
): Promise<SiteSettings> {
	const values = new Map<string, string>();

	for (const row of rows) {
		values.set(row.key, await rowValue(row, rootKey));
	}

	return {
		siteTitle: requiredValue(values, "siteTitle"),
		notionDatabaseUrl: requiredValue(values, "notionDatabaseUrl"),
		notionDatabaseId: requiredValue(values, "notionDatabaseId"),
		notionToken: requiredValue(values, "notionToken"),
		cdnBaseUrl: requiredValue(values, "cdnBaseUrl"),
		albumPostMediaEnabled:
			values.get("albumPostMediaEnabled") === "false" ? false : true,
		fieldMapping: parseFieldMapping(requiredValue(values, "fieldMapping")),
	};
}

export function redactSettings(settings: SiteSettings): RedactedSiteSettings {
	return {
		...settings,
		notionToken: "",
		hasNotionToken: settings.notionToken.length > 0,
	};
}
