import { SettingsRepository } from "./db/d1";

export const albumPostMediaEnabledKey = "albumPostMediaEnabled";

export async function loadAlbumPostMediaEnabled(
	db: D1Database,
): Promise<boolean> {
	const row = await new SettingsRepository(db).get(albumPostMediaEnabledKey);

	return row?.value === "false" ? false : true;
}

export async function saveAlbumPostMediaEnabled(
	db: D1Database,
	enabled: boolean,
	now = new Date().toISOString(),
): Promise<void> {
	await new SettingsRepository(db).put({
		key: albumPostMediaEnabledKey,
		value: enabled ? "true" : "false",
		encrypted: 0,
		updated_at: now,
	});
}
