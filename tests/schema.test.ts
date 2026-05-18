/// <reference types="node" />

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import migrationSql from "../migrations/0001_initial.sql?raw";
import schemaSql from "../workers/db/schema.sql?raw";

const requiredTables = [
	"settings",
	"posts",
	"post_content",
	"assets",
	"sync_runs",
	"sync_items",
];

const requiredIndexes = [
	"idx_posts_visibility_published_at",
	"idx_posts_notion_last_edited_time",
	"idx_assets_content_hash",
	"idx_sync_runs_started_at",
	"idx_sync_items_run_id",
	"idx_sync_items_notion_page_id",
];

const syncRunCountColumns = [
	"created_count",
	"updated_count",
	"metadata_only_count",
	"skipped_count",
	"unpublished_count",
	"archived_count",
	"failed_count",
];

const normalizedSchemaSql = schemaSql.replace(/\s+/g, " ").trim();

describe("D1 schema", () => {
	it("keeps the source schema and initial migration byte-identical", () => {
		expect(migrationSql).toBe(schemaSql);
	});

	it("defines the tables required by the Notion blog design", () => {
		for (const table of requiredTables) {
			expect(schemaSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
		}
	});

	it("defines the indexes required by the Notion blog design", () => {
		for (const index of requiredIndexes) {
			expect(schemaSql).toContain(`CREATE INDEX IF NOT EXISTS ${index}`);
		}
	});

	it("defines key CHECK constraints", () => {
		expect(normalizedSchemaSql).toContain(
			"encrypted INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0, 1))",
		);
		expect(normalizedSchemaSql).toContain(
			"size INTEGER CHECK (size IS NULL OR size >= 0)",
		);
		expect(normalizedSchemaSql).toContain(
			"action TEXT NOT NULL CHECK (action IN ('created', 'updated', 'metadata_only', 'skipped', 'unpublished', 'archived'))",
		);

		for (const column of syncRunCountColumns) {
			expect(normalizedSchemaSql).toContain(
				`${column} INTEGER NOT NULL DEFAULT 0 CHECK (${column} >= 0)`,
			);
		}
	});

	it("executes successfully in SQLite", () => {
		const db = new DatabaseSync(":memory:");

		try {
			db.exec("PRAGMA foreign_keys = ON;");
			db.exec(schemaSql);

			const tables = db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
				.all() as Array<{ name: string }>;

			expect(tables.map(({ name }) => name)).toEqual([
				"assets",
				"post_content",
				"posts",
				"settings",
				"sync_items",
				"sync_runs",
			]);
		} finally {
			db.close();
		}
	});
});
