import { decryptString, encryptString } from "./crypto";
import type { FieldMapping, SiteSettings } from "./types";

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
] as const satisfies readonly (keyof SiteSettings)[];
const optionalFieldMappingKeys = [
	"slug",
	"summary",
	"tags",
	"publishedAt",
	"cover",
] as const satisfies readonly (keyof FieldMapping)[];

export async function serializeSettingsForStorage(
	settings: SiteSettings,
	rootKey: string,
	now = new Date().toISOString(),
): Promise<SettingRow[]> {
	const entries = Object.entries(settings) as [
		keyof SiteSettings,
		SiteSettings[keyof SiteSettings],
	][];
	const rows: SettingRow[] = [];

	for (const [key, rawValue] of entries) {
		const stringValue =
			typeof rawValue === "string" ? rawValue : JSON.stringify(rawValue);
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

	return fieldMapping;
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
