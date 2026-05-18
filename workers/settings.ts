import { encryptString } from "./crypto";
import type { SiteSettings } from "./types";

export interface SettingRow {
	key: string;
	value: string;
	encrypted: 0 | 1;
	updated_at: string;
}

const sensitiveKeys = new Set<keyof SiteSettings>(["notionToken"]);

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

export function redactSettings(settings: SiteSettings): SiteSettings {
	return { ...settings, notionToken: "" };
}
