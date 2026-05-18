import type { SettingRow } from "../settings";

const upsertSettingSql = `INSERT INTO settings (key, value, encrypted, updated_at)
 VALUES (?, ?, ?, ?)
 ON CONFLICT(key) DO UPDATE SET
 value = excluded.value,
 encrypted = excluded.encrypted,
 updated_at = excluded.updated_at`;

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

	async list(): Promise<SettingRow[]> {
		const result = await this.db
			.prepare("SELECT key, value, encrypted, updated_at FROM settings ORDER BY key")
			.all<SettingRow>();

		return result.results;
	}

	async put(row: SettingRow): Promise<void> {
		await this.preparePut(row).run();
	}

	async putMany(rows: SettingRow[]): Promise<void> {
		const statements = rows.map((row) => this.preparePut(row));

		if (statements.length === 0) {
			return;
		}

		const batch = (
			this.db as {
				batch?: (statements: D1PreparedStatement[]) => Promise<unknown>;
			}
		).batch;

		if (batch) {
			await batch.call(this.db, statements);
			return;
		}

		for (const statement of statements) {
			await statement.run();
		}
	}

	private preparePut(row: SettingRow): D1PreparedStatement {
		return this.db
			.prepare(upsertSettingSql)
			.bind(row.key, row.value, row.encrypted, row.updated_at);
	}
}
