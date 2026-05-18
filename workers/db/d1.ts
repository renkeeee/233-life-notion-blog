import type { SettingRow } from "../settings";

export class SettingsRepository {
	constructor(private readonly db: D1Database) {}

	async get(key: string): Promise<SettingRow | null> {
		return this.db
			.prepare(
				"SELECT key, value, encrypted, updated_at FROM settings WHERE key = ?",
			)
			.bind(key)
			.first<SettingRow>();
	}

	async put(row: SettingRow): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO settings (key, value, encrypted, updated_at)
				 VALUES (?, ?, ?, ?)
				 ON CONFLICT(key) DO UPDATE SET
				 value = excluded.value,
				 encrypted = excluded.encrypted,
				 updated_at = excluded.updated_at`,
			)
			.bind(row.key, row.value, row.encrypted, row.updated_at)
			.run();
	}
}
