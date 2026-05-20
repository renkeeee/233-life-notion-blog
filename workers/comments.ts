import { SettingsRepository } from "./db/d1";

export const commentsDefaultEnabledKey = "commentsDefaultEnabled";

export async function loadCommentsDefaultEnabled(
	db: D1Database,
): Promise<boolean> {
	const row = await new SettingsRepository(db).get(commentsDefaultEnabledKey);

	return row?.value === "false" ? false : true;
}

export async function saveCommentsDefaultEnabled(
	db: D1Database,
	enabled: boolean,
	now = new Date().toISOString(),
): Promise<void> {
	await new SettingsRepository(db).put({
		key: commentsDefaultEnabledKey,
		value: enabled ? "true" : "false",
		encrypted: 0,
		updated_at: now,
	});
}
