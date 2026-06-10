import { SettingsRepository } from "./db/d1";

export const scheduledSyncEnabledKey = "scheduledSyncEnabled";

export async function loadScheduledSyncEnabled(
	db: D1Database,
): Promise<boolean> {
	const row = await new SettingsRepository(db).get(scheduledSyncEnabledKey);

	return row?.value === "false" ? false : true;
}

export async function saveScheduledSyncEnabled(
	db: D1Database,
	enabled: boolean,
	now = new Date().toISOString(),
): Promise<void> {
	await new SettingsRepository(db).put({
		key: scheduledSyncEnabledKey,
		value: enabled ? "true" : "false",
		encrypted: 0,
		updated_at: now,
	});
}
