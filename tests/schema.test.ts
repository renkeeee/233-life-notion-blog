/// <reference types="node" />

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import initialMigrationSql from "../migrations/0001_initial.sql?raw";
import simplifyPostMetadataMigrationSql from "../migrations/0002_simplify_post_metadata.sql?raw";
import addPostTagsMigrationSql from "../migrations/0003_add_post_tags.sql?raw";
import addPostExcerptMigrationSql from "../migrations/0004_add_post_excerpt.sql?raw";
import addPostCategoryMigrationSql from "../migrations/0005_add_post_category.sql?raw";
import addPostManagementMigrationSql from "../migrations/0006_add_post_management.sql?raw";
import addCommentsMigrationSql from "../migrations/0007_add_comments.sql?raw";
import addCommentRateLimitsMigrationSql from "../migrations/0008_add_comment_rate_limits.sql?raw";
import addCommentModerationAndRepliesMigrationSql from "../migrations/0009_add_comment_moderation_and_replies.sql?raw";
import addPostMediaMigrationSql from "../migrations/0010_add_post_media.sql?raw";
import addAlbumItemsMigrationSql from "../migrations/0011_album_items.sql?raw";
import schemaSql from "../workers/db/schema.sql?raw";

const requiredTables = [
	"settings",
	"posts",
	"deleted_posts",
	"post_comments",
	"comment_rate_limits",
	"post_tags",
	"post_media",
	"album_items",
	"album_collections",
	"album_item_collections",
	"post_content",
	"assets",
	"sync_runs",
	"sync_items",
];

const requiredIndexes = [
	"idx_posts_visibility_published_at",
	"idx_posts_notion_last_edited_time",
	"idx_post_tags_tag",
	"idx_post_tags_post_id",
	"idx_post_media_post_id",
	"idx_post_media_kind",
	"idx_album_items_visible_taken",
	"idx_album_items_source",
	"idx_album_items_kind",
	"idx_album_items_featured",
	"idx_album_collections_visible_order",
	"idx_album_item_collections_collection",
	"idx_posts_category",
	"idx_posts_management_visibility",
	"idx_deleted_posts_deleted_at",
	"idx_post_comments_post_created_at",
	"idx_post_comments_status_created_at",
	"idx_comment_rate_limits_reset_at",
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

function postColumns(db: DatabaseSync): string[] {
	return (
		db.prepare("PRAGMA table_info(posts)").all() as Array<{ name: string }>
	).map((row) => row.name);
}

function tableNames(db: DatabaseSync): string[] {
	return (
		db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
			.all() as Array<{ name: string }>
	).map((row) => row.name);
}

function tableColumns(db: DatabaseSync, table: string): string[] {
	return (
		db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
	).map((row) => row.name);
}

describe("D1 schema", () => {
	it("keeps only the post metadata columns used by the simplified blog", () => {
		expect(normalizedSchemaSql).not.toContain("summary TEXT");
		expect(normalizedSchemaSql).toContain("excerpt TEXT NOT NULL DEFAULT ''");
		expect(normalizedSchemaSql).toContain("category TEXT");
		expect(normalizedSchemaSql).toContain("cover_url TEXT");
		expect(normalizedSchemaSql).toContain(
			"manual_visibility TEXT NOT NULL DEFAULT 'visible' CHECK (manual_visibility IN ('visible', 'hidden'))",
		);
		expect(normalizedSchemaSql).toContain(
			"locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1))",
		);
		expect(normalizedSchemaSql).toContain("lock_password_encrypted TEXT");
		expect(normalizedSchemaSql).toContain(
			"comments_enabled INTEGER NOT NULL DEFAULT 1 CHECK (comments_enabled IN (0, 1))",
		);
		expect(normalizedSchemaSql).toContain(
			"moderation_status TEXT NOT NULL DEFAULT 'approved' CHECK (moderation_status IN ('pending', 'approved'))",
		);
		expect(normalizedSchemaSql).toContain("reply_body TEXT");
		expect(normalizedSchemaSql).toContain("reply_created_at TEXT");
		expect(normalizedSchemaSql).not.toContain("tags_json TEXT");
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
		expect(normalizedSchemaSql).toContain(
			"force INTEGER NOT NULL DEFAULT 0 CHECK (force IN (0, 1))",
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
				"album_collections",
				"album_item_collections",
				"album_items",
				"assets",
				"comment_rate_limits",
				"deleted_posts",
				"post_comments",
				"post_content",
				"post_media",
				"post_tags",
				"posts",
				"settings",
				"sync_items",
				"sync_runs",
			]);
		} finally {
			db.close();
		}
	});

	it("migrates the initial schema to the current post columns", () => {
		const migratedDb = new DatabaseSync(":memory:");
		const currentDb = new DatabaseSync(":memory:");

		try {
			migratedDb.exec("PRAGMA foreign_keys = ON;");
			migratedDb.exec(initialMigrationSql);
			migratedDb.exec(simplifyPostMetadataMigrationSql);
			migratedDb.exec(addPostTagsMigrationSql);
			migratedDb.exec(addPostExcerptMigrationSql);
			migratedDb.exec(addPostCategoryMigrationSql);
			migratedDb.exec(addPostManagementMigrationSql);
			migratedDb.exec(addCommentsMigrationSql);
			migratedDb.exec(addCommentRateLimitsMigrationSql);
			migratedDb.exec(addCommentModerationAndRepliesMigrationSql);
			migratedDb.exec(addPostMediaMigrationSql);
			migratedDb.exec(addAlbumItemsMigrationSql);

			currentDb.exec("PRAGMA foreign_keys = ON;");
			currentDb.exec(schemaSql);

			expect(postColumns(migratedDb)).toEqual(postColumns(currentDb));
			expect(tableNames(migratedDb)).toEqual(tableNames(currentDb));
			expect(postColumns(currentDb)).toEqual([
				"id",
				"notion_page_id",
				"slug",
				"title",
				"cover_url",
				"status",
				"visibility",
				"published_at",
				"notion_last_edited_time",
				"content_hash",
				"last_sync_error",
				"created_at",
				"updated_at",
				"excerpt",
				"category",
				"manual_visibility",
				"locked",
				"lock_password_encrypted",
				"comments_enabled",
			]);
			expect(tableColumns(currentDb, "post_comments")).toEqual([
				"id",
				"post_id",
				"nickname",
				"body",
				"created_at",
				"moderation_status",
				"reply_body",
				"reply_created_at",
			]);
			expect(tableColumns(currentDb, "post_media")).toEqual([
				"id",
				"post_id",
				"block_id",
				"kind",
				"url",
				"caption",
				"r2_key",
				"content_hash",
				"sort_order",
				"created_at",
				"updated_at",
			]);
			expect(tableColumns(currentDb, "album_items")).toEqual([
				"id",
				"source_type",
				"source_id",
				"post_id",
				"kind",
				"url",
				"thumbnail_url",
				"large_url",
				"r2_key",
				"title",
				"description",
				"caption",
				"taken_at",
				"location_name",
				"latitude",
				"longitude",
				"visibility",
				"featured",
				"sort_order",
				"source_content_hash",
				"exif_json",
				"created_at",
				"updated_at",
			]);
			expect(tableColumns(currentDb, "album_collections")).toEqual([
				"id",
				"slug",
				"title",
				"description",
				"cover_item_id",
				"visibility",
				"sort_order",
				"created_at",
				"updated_at",
			]);
			expect(tableColumns(currentDb, "album_item_collections")).toEqual([
				"item_id",
				"collection_id",
				"sort_order",
			]);
		} finally {
			migratedDb.close();
			currentDb.close();
		}
	});
});
