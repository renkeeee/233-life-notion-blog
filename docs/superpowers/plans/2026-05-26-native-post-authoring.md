# Native Post Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add website-native post authoring with local drafts, explicit publishing, MDXEditor Markdown editing, R2 image upload, and automatic Album media creation.

**Architecture:** Add `source_type/source_id` to `posts` and store editable state in `post_drafts`. Local posts publish into the existing public tables (`posts`, `post_content`, `post_tags`, `post_media`, `album_items`) so the public site keeps one rendering/query path. Notion sync remains read-only for Notion content and ignores local posts.

**Tech Stack:** Cloudflare Worker, D1, R2, React 19, React Router 7, MDXEditor (`@mdxeditor/editor`), Vitest, node:sqlite test fixtures.

---

## File Structure

Create or modify these files:

- Create `migrations/0012_native_post_authoring.sql`: D1 migration for `posts.source_type`, `posts.source_id`, `post_drafts`, and indexes.
- Modify `workers/db/schema.sql`: keep the local dev/test schema aligned with migrations.
- Create `workers/local-posts.ts`: local draft validation, slug normalization, Markdown image extraction, upload validation, draft CRUD, publish/unpublish service functions.
- Modify `workers/types.ts`: add `PostSourceType`, `sourceType` on public/admin post records where needed.
- Modify `workers/api/admin.ts`: wire local post and upload routes, add source-aware posts list/action behavior.
- Modify `workers/sync.ts`: mark Notion writes as `source_type='notion'` and ensure local rows cannot be overwritten by sync.
- Modify `workers/db/d1.ts`: include `source_type` in public row mapping if the public API should expose it.
- Modify `app/components/admin/PostStatusTable.tsx`: add `New post`, `Edit` for local posts, hide `Resync` for local posts, and open the editor subview.
- Create `app/components/admin/LocalPostEditor.tsx`: MDXEditor-based draft editor.
- Modify `app/routes/admin.tsx`: pass admin session/CSRF through to the editor flow if needed.
- Modify `app/app.css`: admin editor layout, MDXEditor containment, upload states, compact local/source labels.
- Modify `package.json` and `package-lock.json`: add `@mdxeditor/editor`.
- Modify tests:
  - `tests/schema.test.ts`
  - `tests/sync.test.ts`
  - `tests/admin-api.test.ts`
  - `tests/public-api.test.ts`
  - `tests/admin-ui.test.tsx`
  - Add `tests/local-posts.test.ts`

Implementation should keep `workers/api/admin.ts` route wiring thin. Put local-post business logic in `workers/local-posts.ts` so admin routing does not become the authoring service.

## External Reference

MDXEditor official getting-started docs confirm the package name and stylesheet import:

```bash
npm install --save @mdxeditor/editor
```

```ts
import { MDXEditor } from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
```

Source: https://mdxeditor.dev/editor/docs/getting-started

---

### Task 1: Add Native Authoring Schema

**Files:**
- Create: `migrations/0012_native_post_authoring.sql`
- Modify: `workers/db/schema.sql`
- Modify: `tests/schema.test.ts`

- [ ] **Step 1: Write the failing schema test**

Update `tests/schema.test.ts` imports:

```ts
import nativePostAuthoringMigrationSql from "../migrations/0012_native_post_authoring.sql?raw";
```

Add `post_drafts` to `requiredTables`:

```ts
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
	"post_drafts",
	"assets",
	"sync_runs",
	"sync_items",
];
```

Add required indexes:

```ts
const requiredIndexes = [
	"idx_posts_visibility_published_at",
	"idx_posts_notion_last_edited_time",
	"idx_posts_source",
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
	"idx_post_drafts_post_id",
	"idx_post_drafts_status_updated",
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
```

Update the migration chain:

```ts
migratedDb.exec(addAlbumItemsMigrationSql);
migratedDb.exec(nativePostAuthoringMigrationSql);
```

Update expected `posts` columns:

```ts
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
	"source_type",
	"source_id",
]);
```

Add expected draft columns:

```ts
expect(tableColumns(currentDb, "post_drafts")).toEqual([
	"id",
	"post_id",
	"title",
	"slug",
	"excerpt",
	"markdown",
	"cover_url",
	"category",
	"tags_json",
	"status",
	"comments_enabled",
	"published_at",
	"created_at",
	"updated_at",
]);
```

Update the schema execution table list to include `post_drafts` in sorted order:

```ts
expect(tables.map(({ name }) => name)).toEqual([
	"album_collections",
	"album_item_collections",
	"album_items",
	"assets",
	"comment_rate_limits",
	"deleted_posts",
	"post_comments",
	"post_content",
	"post_drafts",
	"post_media",
	"post_tags",
	"posts",
	"settings",
	"sync_items",
	"sync_runs",
]);
```

- [ ] **Step 2: Run the schema test to verify it fails**

Run:

```bash
npm test -- tests/schema.test.ts
```

Expected: FAIL because `migrations/0012_native_post_authoring.sql`, `post_drafts`, `source_type`, and indexes do not exist.

- [ ] **Step 3: Add the D1 migration**

Create `migrations/0012_native_post_authoring.sql`:

```sql
ALTER TABLE posts
	ADD COLUMN source_type TEXT NOT NULL DEFAULT 'notion'
	CHECK (source_type IN ('notion', 'local'));

ALTER TABLE posts
	ADD COLUMN source_id TEXT;

UPDATE posts
SET source_type = 'notion',
	source_id = notion_page_id
WHERE source_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_posts_source
	ON posts (source_type, source_id);

CREATE TABLE IF NOT EXISTS post_drafts (
	id TEXT PRIMARY KEY,
	post_id TEXT,
	title TEXT NOT NULL,
	slug TEXT,
	excerpt TEXT,
	markdown TEXT NOT NULL,
	cover_url TEXT,
	category TEXT,
	tags_json TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL DEFAULT 'draft'
		CHECK (status IN ('draft', 'published', 'archived')),
	comments_enabled INTEGER CHECK (comments_enabled IS NULL OR comments_enabled IN (0, 1)),
	published_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_post_drafts_post_id
	ON post_drafts (post_id);

CREATE INDEX IF NOT EXISTS idx_post_drafts_status_updated
	ON post_drafts (status, updated_at DESC);
```

- [ ] **Step 4: Update the canonical schema**

In `workers/db/schema.sql`, add to `posts` after `comments_enabled`:

```sql
	source_type TEXT NOT NULL DEFAULT 'notion' CHECK (source_type IN ('notion', 'local')),
	source_id TEXT
```

Because `comments_enabled` is currently the last column, change its line to include a trailing comma:

```sql
	comments_enabled INTEGER NOT NULL DEFAULT 1 CHECK (comments_enabled IN (0, 1)),
	source_type TEXT NOT NULL DEFAULT 'notion' CHECK (source_type IN ('notion', 'local')),
	source_id TEXT
);
```

Add the source index after the existing post indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_posts_source
	ON posts (source_type, source_id);
```

Add the draft table near `post_content`:

```sql
CREATE TABLE IF NOT EXISTS post_drafts (
	id TEXT PRIMARY KEY,
	post_id TEXT,
	title TEXT NOT NULL,
	slug TEXT,
	excerpt TEXT,
	markdown TEXT NOT NULL,
	cover_url TEXT,
	category TEXT,
	tags_json TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
	comments_enabled INTEGER CHECK (comments_enabled IS NULL OR comments_enabled IN (0, 1)),
	published_at TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_post_drafts_post_id
	ON post_drafts (post_id);

CREATE INDEX IF NOT EXISTS idx_post_drafts_status_updated
	ON post_drafts (status, updated_at DESC);
```

- [ ] **Step 5: Run the schema test**

Run:

```bash
npm test -- tests/schema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit schema work**

Run:

```bash
git add migrations/0012_native_post_authoring.sql workers/db/schema.sql tests/schema.test.ts
git commit -m "Add native post authoring schema"
```

---

### Task 2: Add Local Post Service Foundation

**Files:**
- Create: `workers/local-posts.ts`
- Modify: `workers/types.ts`
- Create: `tests/local-posts.test.ts`

- [ ] **Step 1: Write failing validation and utility tests**

Create `tests/local-posts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	extractMarkdownImageUrls,
	normalizeLocalPostSlug,
	validateLocalDraftInput,
	validateLocalPublishInput,
} from "../workers/local-posts";

describe("local post authoring utilities", () => {
	it("normalizes slugs to lowercase hyphenated text", () => {
		expect(normalizeLocalPostSlug(" Hello World 2026 ")).toBe("hello-world-2026");
		expect(normalizeLocalPostSlug("A__B---C")).toBe("a-b-c");
	});

	it("rejects invalid publish slugs", () => {
		expect(() =>
			validateLocalPublishInput({
				title: "Hello",
				slug: "Hello World",
				markdown: "Body",
			}),
		).toThrow("Slug must contain only lowercase letters, numbers, and hyphens");
	});

	it("allows draft markdown to be empty but requires a title", () => {
		expect(
			validateLocalDraftInput({
				title: "Draft",
				slug: "",
				markdown: "",
				tags: ["life", "notes"],
			}),
		).toMatchObject({
			title: "Draft",
			slug: null,
			markdown: "",
			tags: ["life", "notes"],
		});
	});

	it("extracts Markdown image urls in document order", () => {
		expect(
			extractMarkdownImageUrls(
				"![one](https://assets.233.life/assets/a.jpg)\n\n![two](https://example.com/two.png)",
			),
		).toEqual([
			"https://assets.233.life/assets/a.jpg",
			"https://example.com/two.png",
		]);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/local-posts.test.ts
```

Expected: FAIL because `workers/local-posts.ts` does not exist.

- [ ] **Step 3: Add shared source type**

In `workers/types.ts`, add:

```ts
export type PostSourceType = "notion" | "local";
```

Extend `PublicPostRecord`:

```ts
export interface PublicPostRecord {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	status: string;
	visibility: PostVisibility;
	sourceType?: PostSourceType;
	locked?: boolean;
	commentsEnabled?: boolean;
	comments?: PublicPostComment[];
	publishedAt: string | null;
	updatedAt: string;
}
```

- [ ] **Step 4: Create local post utility functions**

Create `workers/local-posts.ts` with these initial exports:

```ts
import { buildAssetKey, cdnUrlForKey, contentHashForBytes, uploadAssetIfMissing } from "./assets";
import { sha256Hex } from "./crypto";
import { loadCommentsDefaultEnabled } from "./comments";
import type { AppEnv, PostSourceType, PublicAlbumMediaKind } from "./types";

export type LocalDraftStatus = "draft" | "published" | "archived";

export type LocalDraftInput = {
	title: unknown;
	slug?: unknown;
	excerpt?: unknown;
	markdown?: unknown;
	coverUrl?: unknown;
	category?: unknown;
	tags?: unknown;
	commentsEnabled?: unknown;
	publishedAt?: unknown;
};

export type ValidLocalDraftInput = {
	title: string;
	slug: string | null;
	excerpt: string;
	markdown: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	commentsEnabled: boolean | null;
	publishedAt: string | null;
};

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function cleanOptionalString(value: unknown): string | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "string") {
		throw new Error("Expected string value");
	}
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

export function normalizeLocalPostSlug(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
}

export function validateLocalDraftInput(input: LocalDraftInput): ValidLocalDraftInput {
	if (typeof input.title !== "string" || !input.title.trim()) {
		throw new Error("Title is required");
	}

	const slug = cleanOptionalString(input.slug);
	if (slug && !slugPattern.test(slug)) {
		throw new Error("Slug must contain only lowercase letters, numbers, and hyphens");
	}

	const tags =
		Array.isArray(input.tags)
			? input.tags
					.filter((tag): tag is string => typeof tag === "string")
					.map((tag) => tag.trim())
					.filter(Boolean)
			: [];

	return {
		title: input.title.trim(),
		slug,
		excerpt: cleanOptionalString(input.excerpt) ?? "",
		markdown: typeof input.markdown === "string" ? input.markdown : "",
		coverUrl: cleanOptionalString(input.coverUrl),
		category: cleanOptionalString(input.category),
		tags: [...new Set(tags)],
		commentsEnabled:
			typeof input.commentsEnabled === "boolean" ? input.commentsEnabled : null,
		publishedAt: cleanOptionalString(input.publishedAt),
	};
}

export function validateLocalPublishInput(input: LocalDraftInput): ValidLocalDraftInput {
	const draft = validateLocalDraftInput(input);

	if (!draft.slug) {
		throw new Error("Slug is required");
	}
	if (!slugPattern.test(draft.slug)) {
		throw new Error("Slug must contain only lowercase letters, numbers, and hyphens");
	}
	if (!draft.markdown.trim()) {
		throw new Error("Markdown body is required");
	}

	return draft;
}

export function extractMarkdownImageUrls(markdown: string): string[] {
	const urls: string[] = [];
	const pattern = /!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(markdown))) {
		urls.push(match[1]);
	}

	return urls;
}
```

- [ ] **Step 5: Run the local utility tests**

Run:

```bash
npm test -- tests/local-posts.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit utility foundation**

Run:

```bash
git add workers/local-posts.ts workers/types.ts tests/local-posts.test.ts
git commit -m "Add local post authoring utilities"
```

---

### Task 3: Implement Local Draft CRUD Admin API

**Files:**
- Modify: `workers/local-posts.ts`
- Modify: `workers/api/admin.ts`
- Modify: `tests/admin-api.test.ts`

- [ ] **Step 1: Add authenticated route tests**

In `tests/admin-api.test.ts`, extend the fake D1 or create a SQLite-backed admin test helper for local drafts. Use the real schema so draft SQL is exercised.

Add this helper below `adminRequest`:

```ts
function csrfHeaders(token: string): HeadersInit {
	return {
		"content-type": "application/json",
		"x-csrf-token": token,
	};
}

async function login(env: AppEnv): Promise<{ cookie: string; csrfToken: string }> {
	const response = await handleAdminApi(
		adminRequest("/api/admin/login", {
			body: JSON.stringify({ password: "123456" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		env,
	);
	const body = (await response.json()) as { csrfToken: string };
	return {
		cookie: response.headers.get("set-cookie") ?? "",
		csrfToken: body.csrfToken,
	};
}
```

Add tests:

```ts
it("creates and loads a local post draft", async () => {
	const env = sqliteAdminEnv();
	const session = await login(env);

	const createResponse = await handleAdminApi(
		adminRequest("/api/admin/local-posts", {
			body: JSON.stringify({ title: "A quiet note" }),
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "POST",
		}),
		env,
	);

	expect(createResponse.status).toBe(200);
	const created = (await createResponse.json()) as { draft: { id: string; title: string } };
	expect(created.draft.title).toBe("A quiet note");

	const getResponse = await handleAdminApi(
		adminRequest(`/api/admin/local-posts/${created.draft.id}`, {
			headers: { cookie: session.cookie },
			method: "GET",
		}),
		env,
	);

	expect(getResponse.status).toBe(200);
	await expect(getResponse.json()).resolves.toMatchObject({
		draft: {
			id: created.draft.id,
			title: "A quiet note",
			status: "draft",
		},
	});
});

it("updates a local post draft without creating a public post", async () => {
	const env = sqliteAdminEnv();
	const session = await login(env);
	const draft = await createDraftThroughApi(env, session, "Draft only");

	const updateResponse = await handleAdminApi(
		adminRequest(`/api/admin/local-posts/${draft.id}`, {
			body: JSON.stringify({
				title: "Updated draft",
				slug: "updated-draft",
				markdown: "Draft body",
				tags: ["life"],
			}),
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "PUT",
		}),
		env,
	);

	expect(updateResponse.status).toBe(200);
	expect(sqliteRows(env.DB, "SELECT * FROM posts")).toEqual([]);
});
```

Add these concrete helpers to `tests/admin-api.test.ts` for the route tests:

```ts
import { DatabaseSync } from "node:sqlite";
import schemaSql from "../workers/db/schema.sql?raw";

class SqliteD1PreparedStatement {
	private values: unknown[] = [];

	constructor(
		private readonly statement: ReturnType<DatabaseSync["prepare"]>,
		private readonly sql: string,
		private readonly calls: Array<{ sql: string; values: unknown[] }>,
	) {}

	bind(...values: unknown[]): D1PreparedStatement {
		this.values = values;
		return this as unknown as D1PreparedStatement;
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		this.calls.push({ sql: this.sql, values: this.values });
		return this.statement.get(...(this.values as Array<string | number | null>)) as T | null;
	}

	async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
		this.calls.push({ sql: this.sql, values: this.values });
		return {
			results: this.statement.all(...(this.values as Array<string | number | null>)) as T[],
			success: true,
			meta: {},
		} as D1Result<T>;
	}

	async run(): Promise<D1Result> {
		this.calls.push({ sql: this.sql, values: this.values });
		this.statement.run(...(this.values as Array<string | number | null>));
		return { results: [], success: true, meta: {} } as unknown as D1Result;
	}
}

function fakeR2Bucket(): R2Bucket {
	return {
		head: vi.fn().mockResolvedValue(null),
		put: vi.fn().mockResolvedValue({}),
	} as unknown as R2Bucket;
}

class SqliteAdminD1 {
	readonly calls: Array<{ sql: string; values: unknown[] }> = [];
	private readonly db = new DatabaseSync(":memory:");

	constructor() {
		this.db.exec("PRAGMA foreign_keys = ON;");
		this.db.exec(schemaSql);
	}

	prepare(sql: string): D1PreparedStatement {
		return new SqliteD1PreparedStatement(
			this.db.prepare(sql),
			sql,
			this.calls,
		) as unknown as D1PreparedStatement;
	}

	rows<T = Record<string, unknown>>(sql: string): T[] {
		return this.db.prepare(sql).all() as T[];
	}

	asD1(): D1Database {
		return this as unknown as D1Database;
	}
}

function sqliteAdminEnv(): AppEnv {
	const db = new SqliteAdminD1();
	db.prepare("INSERT INTO settings (key, value, encrypted, updated_at) VALUES (?, ?, 0, ?)")
		.bind("cdnBaseUrl", "https://assets.233.life", "2026-05-26T00:00:00.000Z")
		.run();
	return {
		DB: db.asD1(),
		BLOG_ASSETS: fakeR2Bucket(),
		CONFIG_ENCRYPTION_KEY: generateEncryptionKey(),
	};
}

function sqliteRows<T = Record<string, unknown>>(db: D1Database, sql: string): T[] {
	return (db as unknown as SqliteAdminD1).rows<T>(sql);
}

async function createDraftThroughApi(
	env: AppEnv,
	session: { cookie: string; csrfToken: string },
	title: string,
): Promise<{ id: string }> {
	const response = await handleAdminApi(
		adminRequest("/api/admin/local-posts", {
			body: JSON.stringify({ title }),
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "POST",
		}),
		env,
	);
	const body = (await response.json()) as { draft: { id: string } };
	return body.draft;
}

async function updateDraftThroughApi(
	env: AppEnv,
	session: { cookie: string; csrfToken: string },
	draftId: string,
	body: Record<string, unknown>,
): Promise<void> {
	await handleAdminApi(
		adminRequest(`/api/admin/local-posts/${draftId}`, {
			body: JSON.stringify(body),
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "PUT",
		}),
		env,
	);
}

function insertPublicPost(
	db: D1Database,
	row: {
		id: string;
		notion_page_id?: string;
		slug: string;
		title: string;
		source_type?: "notion" | "local";
		source_id?: string;
	},
): void {
	(db as unknown as SqliteAdminD1)
		.prepare(
			`INSERT INTO posts (
				id, notion_page_id, slug, title, cover_url, status, visibility,
				published_at, notion_last_edited_time, content_hash, last_sync_error,
				created_at, updated_at, excerpt, category, comments_enabled,
				source_type, source_id
			)
			VALUES (?, ?, ?, ?, NULL, ?, 'published', ?, ?, 'hash', NULL, ?, ?, '', NULL, 1, ?, ?)`,
		)
		.bind(
			row.id,
			row.notion_page_id ?? row.id,
			row.slug,
			row.title,
			row.source_type === "local" ? "local" : "Published",
			"2026-05-26T00:00:00.000Z",
			"2026-05-26T00:00:00.000Z",
			"2026-05-26T00:00:00.000Z",
			"2026-05-26T00:00:00.000Z",
			row.source_type ?? "notion",
			row.source_id ?? row.notion_page_id ?? row.id,
		)
		.run();
}

function insertPublishedLocalPostWithContent(
	db: D1Database,
	row: { id: string; slug: string; title: string; markdown: string },
): void {
	insertPublicPost(db, {
		id: row.id,
		notion_page_id: `local:${row.id}`,
		slug: row.slug,
		title: row.title,
		source_type: "local",
		source_id: row.id,
	});
	(db as unknown as SqliteAdminD1)
		.prepare(
			`INSERT INTO post_content (
				post_id, markdown, block_snapshot_hash, content_hash,
				resource_refs_json, created_at, updated_at
			)
			VALUES (?, ?, 'local:hash', 'hash', '[]', ?, ?)`,
		)
		.bind(row.id, row.markdown, "2026-05-26T00:00:00.000Z", "2026-05-26T00:00:00.000Z")
		.run();
}

async function createAndPublishLocalPost(
	env: AppEnv,
	session: { cookie: string; csrfToken: string },
	body: { title: string; slug: string; markdown: string },
): Promise<{ id: string }> {
	const draft = await createDraftThroughApi(env, session, body.title);
	await updateDraftThroughApi(env, session, draft.id, body);
	await handleAdminApi(
		adminRequest(`/api/admin/local-posts/${draft.id}/publish`, {
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "POST",
		}),
		env,
	);
	return draft;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/admin-api.test.ts
```

Expected: FAIL because local-post API routes do not exist.

- [ ] **Step 3: Add draft service functions**

Extend `workers/local-posts.ts`:

```ts
export type LocalDraftRecord = {
	id: string;
	postId: string | null;
	title: string;
	slug: string | null;
	excerpt: string;
	markdown: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	status: LocalDraftStatus;
	commentsEnabled: boolean | null;
	publishedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

type LocalDraftRow = {
	id: string;
	post_id: string | null;
	title: string;
	slug: string | null;
	excerpt: string | null;
	markdown: string;
	cover_url: string | null;
	category: string | null;
	tags_json: string;
	status: LocalDraftStatus;
	comments_enabled: number | null;
	published_at: string | null;
	created_at: string;
	updated_at: string;
};

function parseTagsJson(value: string): string[] {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((tag): tag is string => typeof tag === "string")
			: [];
	} catch {
		return [];
	}
}

function mapDraftRow(row: LocalDraftRow): LocalDraftRecord {
	return {
		id: row.id,
		postId: row.post_id,
		title: row.title,
		slug: row.slug,
		excerpt: row.excerpt ?? "",
		markdown: row.markdown,
		coverUrl: row.cover_url,
		category: row.category,
		tags: parseTagsJson(row.tags_json),
		status: row.status,
		commentsEnabled:
			row.comments_enabled === null ? null : row.comments_enabled === 1,
		publishedAt: row.published_at,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

export async function createLocalDraft(env: AppEnv, input: LocalDraftInput, now = new Date().toISOString()): Promise<LocalDraftRecord> {
	const draft = validateLocalDraftInput(input);
	const id = crypto.randomUUID();

	await env.DB.prepare(
		`INSERT INTO post_drafts (
			id, post_id, title, slug, excerpt, markdown, cover_url, category,
			tags_json, status, comments_enabled, published_at, created_at, updated_at
		)
		VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
	)
		.bind(
			id,
			draft.title,
			draft.slug,
			draft.excerpt,
			draft.markdown,
			draft.coverUrl,
			draft.category,
			JSON.stringify(draft.tags),
			draft.commentsEnabled === null ? null : draft.commentsEnabled ? 1 : 0,
			draft.publishedAt,
			now,
			now,
		)
		.run();

	return getLocalDraft(env, id).then((record) => {
		if (!record) {
			throw new Error("Draft could not be loaded after creation");
		}
		return record;
	});
}

export async function getLocalDraft(env: AppEnv, id: string): Promise<LocalDraftRecord | null> {
	const row = await env.DB.prepare(
		`SELECT
			id, post_id, title, slug, excerpt, markdown, cover_url, category,
			tags_json, status, comments_enabled, published_at, created_at, updated_at
		 FROM post_drafts
		 WHERE id = ?
		 LIMIT 1`,
	)
		.bind(id)
		.first<LocalDraftRow>();

	return row ? mapDraftRow(row) : null;
}

export async function updateLocalDraft(env: AppEnv, id: string, input: LocalDraftInput, now = new Date().toISOString()): Promise<LocalDraftRecord | null> {
	const draft = validateLocalDraftInput(input);
	const existing = await getLocalDraft(env, id);
	if (!existing) {
		return null;
	}

	await env.DB.prepare(
		`UPDATE post_drafts
		 SET title = ?,
			 slug = ?,
			 excerpt = ?,
			 markdown = ?,
			 cover_url = ?,
			 category = ?,
			 tags_json = ?,
			 comments_enabled = ?,
			 published_at = ?,
			 updated_at = ?
		 WHERE id = ?`,
	)
		.bind(
			draft.title,
			draft.slug,
			draft.excerpt,
			draft.markdown,
			draft.coverUrl,
			draft.category,
			JSON.stringify(draft.tags),
			draft.commentsEnabled === null ? null : draft.commentsEnabled ? 1 : 0,
			draft.publishedAt,
			now,
			id,
		)
		.run();

	return getLocalDraft(env, id);
}

export function localDraftResponse(draft: LocalDraftRecord) {
	return { draft };
}
```

- [ ] **Step 4: Wire admin routes**

In `workers/api/admin.ts`, import:

```ts
import {
	createLocalDraft,
	getLocalDraft,
	localDraftResponse,
	updateLocalDraft,
} from "../local-posts";
```

Add path parser:

```ts
function adminLocalDraftPath(pathname: string): { draftId: string } | null {
	const match = /^\/api\/admin\/local-posts\/([^/]+)$/.exec(pathname);
	const draftId = match ? decodePathSegment(match[1]) : null;
	return draftId ? { draftId } : null;
}
```

Add handlers:

```ts
async function handleCreateLocalDraft(request: Request, env: AppEnv): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);
	if (session instanceof Response) return session;
	const csrfError = requireCsrf(request, session);
	if (csrfError) return csrfError;

	try {
		const draft = await createLocalDraft(env, await readJsonObject(request));
		return json(localDraftResponse(draft));
	} catch (error) {
		return errorJson(
			"BAD_REQUEST",
			error instanceof Error ? error.message : "Invalid local draft",
			400,
		);
	}
}

async function handleGetLocalDraft(request: Request, env: AppEnv, draftId: string): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);
	if (session instanceof Response) return session;

	const draft = await getLocalDraft(env, draftId);
	return draft
		? json(localDraftResponse(draft))
		: errorJson("NOT_FOUND", "Draft not found", 404);
}

async function handleUpdateLocalDraft(request: Request, env: AppEnv, draftId: string): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);
	if (session instanceof Response) return session;
	const csrfError = requireCsrf(request, session);
	if (csrfError) return csrfError;

	try {
		const draft = await updateLocalDraft(env, draftId, await readJsonObject(request));
		return draft
			? json(localDraftResponse(draft))
			: errorJson("NOT_FOUND", "Draft not found", 404);
	} catch (error) {
		return errorJson(
			"BAD_REQUEST",
			error instanceof Error ? error.message : "Invalid local draft",
			400,
		);
	}
}
```

In `handleAdminApi`, before album routes:

```ts
if (url.pathname === "/api/admin/local-posts" && request.method === "POST") {
	return handleCreateLocalDraft(request, env);
}

const localDraft = adminLocalDraftPath(url.pathname);
if (localDraft && request.method === "GET") {
	return handleGetLocalDraft(request, env, localDraft.draftId);
}

if (localDraft && request.method === "PUT") {
	return handleUpdateLocalDraft(request, env, localDraft.draftId);
}
```

- [ ] **Step 5: Run route tests**

Run:

```bash
npm test -- tests/admin-api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit draft API**

Run:

```bash
git add workers/local-posts.ts workers/api/admin.ts tests/admin-api.test.ts
git commit -m "Add local draft admin API"
```

---

### Task 4: Publish and Unpublish Local Posts

**Files:**
- Modify: `workers/local-posts.ts`
- Modify: `workers/api/admin.ts`
- Modify: `tests/local-posts.test.ts`
- Modify: `tests/admin-api.test.ts`
- Modify: `tests/public-api.test.ts`

- [ ] **Step 1: Write publish behavior tests**

Add to `tests/admin-api.test.ts`:

```ts
it("publishes a local draft into public post tables", async () => {
	const env = sqliteAdminEnv();
	const session = await login(env);
	const draft = await createDraftThroughApi(env, session, "Local hello");

	await handleAdminApi(
		adminRequest(`/api/admin/local-posts/${draft.id}`, {
			body: JSON.stringify({
				title: "Local hello",
				slug: "local-hello",
				excerpt: "A local excerpt",
				markdown: "Hello from **local** writing.",
				category: "Life",
				tags: ["local", "writing"],
				commentsEnabled: true,
			}),
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "PUT",
		}),
		env,
	);

	const publishResponse = await handleAdminApi(
		adminRequest(`/api/admin/local-posts/${draft.id}/publish`, {
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "POST",
		}),
		env,
	);

	expect(publishResponse.status).toBe(200);
	expect(sqliteRows(env.DB, "SELECT source_type, slug, title FROM posts")).toEqual([
		expect.objectContaining({
			source_type: "local",
			slug: "local-hello",
			title: "Local hello",
		}),
	]);
	expect(sqliteRows(env.DB, "SELECT tag FROM post_tags ORDER BY sort_order")).toEqual([
		{ tag: "local" },
		{ tag: "writing" },
	]);
	expect(sqliteRows(env.DB, "SELECT markdown FROM post_content")).toEqual([
		{ markdown: "Hello from **local** writing." },
	]);
});

it("rejects publishing when slug already belongs to another post", async () => {
	const env = sqliteAdminEnv();
	insertPublicPost(env.DB, { id: "existing", slug: "same-slug", title: "Existing" });
	const session = await login(env);
	const draft = await createDraftThroughApi(env, session, "Conflict");
	await updateDraftThroughApi(env, session, draft.id, {
		title: "Conflict",
		slug: "same-slug",
		markdown: "Body",
	});

	const response = await handleAdminApi(
		adminRequest(`/api/admin/local-posts/${draft.id}/publish`, {
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "POST",
		}),
		env,
	);

	expect(response.status).toBe(400);
	await expect(response.json()).resolves.toEqual({
		error: { code: "BAD_REQUEST", message: "Slug already exists" },
	});
});

it("unpublishes a local post by archiving the public row", async () => {
	const env = sqliteAdminEnv();
	const session = await login(env);
	const draft = await createAndPublishLocalPost(env, session, {
		title: "Temporary",
		slug: "temporary",
		markdown: "Visible body",
	});

	const response = await handleAdminApi(
		adminRequest(`/api/admin/local-posts/${draft.id}/unpublish`, {
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "POST",
		}),
		env,
	);

	expect(response.status).toBe(200);
	expect(sqliteRows(env.DB, "SELECT visibility FROM posts WHERE slug = 'temporary'")).toEqual([
		{ visibility: "archived" },
	]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/admin-api.test.ts
```

Expected: FAIL because publish/unpublish routes and service functions do not exist.

- [ ] **Step 3: Add publish helpers**

In `workers/local-posts.ts`, add:

```ts
async function contentHashForMarkdown(markdown: string): Promise<string> {
	return sha256Hex(markdown);
}

async function ensureUniqueSlug(env: AppEnv, slug: string, postId: string | null): Promise<void> {
	const row = await env.DB.prepare(
		`SELECT id
		 FROM posts
		 WHERE slug = ?
		 AND (? IS NULL OR id <> ?)
		 LIMIT 1`,
	)
		.bind(slug, postId, postId)
		.first<{ id: string }>();

	if (row) {
		throw new Error("Slug already exists");
	}
}

async function replacePostTags(env: AppEnv, postId: string, tags: string[], now: string): Promise<void> {
	await env.DB.prepare("DELETE FROM post_tags WHERE post_id = ?").bind(postId).run();
	for (const [index, tag] of tags.entries()) {
		await env.DB.prepare(
			`INSERT INTO post_tags (post_id, tag, sort_order, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?)`,
		)
			.bind(postId, tag, index, now, now)
			.run();
	}
}

export async function publishLocalDraft(env: AppEnv, draftId: string, now = new Date().toISOString()): Promise<LocalDraftRecord | null> {
	const draft = await getLocalDraft(env, draftId);
	if (!draft) {
		return null;
	}

	const input = validateLocalPublishInput({
		title: draft.title,
		slug: draft.slug,
		excerpt: draft.excerpt,
		markdown: draft.markdown,
		coverUrl: draft.coverUrl,
		category: draft.category,
		tags: draft.tags,
		commentsEnabled: draft.commentsEnabled,
		publishedAt: draft.publishedAt,
	});
	const postId = draft.postId ?? crypto.randomUUID();
	const sourceId = draft.postId ? postId : crypto.randomUUID();
	const contentHash = await contentHashForMarkdown(input.markdown);
	const publishedAt = input.publishedAt ?? draft.publishedAt ?? now;
	const commentsEnabled =
		input.commentsEnabled ?? (await loadCommentsDefaultEnabled(env.DB));

	await ensureUniqueSlug(env, input.slug as string, draft.postId);

	await env.DB.prepare(
		`INSERT INTO posts (
			id, notion_page_id, slug, title, cover_url, status, visibility,
			published_at, notion_last_edited_time, content_hash, last_sync_error,
			created_at, updated_at, excerpt, category, comments_enabled,
			source_type, source_id
		)
		VALUES (?, ?, ?, ?, ?, 'local', 'published', ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'local', ?)
		ON CONFLICT(id) DO UPDATE SET
			slug = excluded.slug,
			title = excluded.title,
			cover_url = excluded.cover_url,
			status = 'local',
			visibility = 'published',
			published_at = excluded.published_at,
			notion_last_edited_time = excluded.notion_last_edited_time,
			content_hash = excluded.content_hash,
			last_sync_error = NULL,
			updated_at = excluded.updated_at,
			excerpt = excluded.excerpt,
			category = excluded.category,
			comments_enabled = excluded.comments_enabled,
			source_type = 'local',
			source_id = excluded.source_id`,
	)
		.bind(
			postId,
			`local:${sourceId}`,
			input.slug,
			input.title,
			input.coverUrl,
			publishedAt,
			now,
			contentHash,
			now,
			now,
			input.excerpt,
			input.category,
			commentsEnabled ? 1 : 0,
			sourceId,
		)
		.run();

	await env.DB.prepare(
		`INSERT INTO post_content (
			post_id, markdown, block_snapshot_hash, content_hash, resource_refs_json,
			created_at, updated_at
		)
		VALUES (?, ?, ?, ?, '[]', ?, ?)
		ON CONFLICT(post_id) DO UPDATE SET
			markdown = excluded.markdown,
			block_snapshot_hash = excluded.block_snapshot_hash,
			content_hash = excluded.content_hash,
			resource_refs_json = excluded.resource_refs_json,
			updated_at = excluded.updated_at`,
	)
		.bind(postId, input.markdown, `local:${contentHash}`, contentHash, now, now)
		.run();

	await replacePostTags(env, postId, input.tags, now);

	await env.DB.prepare(
		`UPDATE post_drafts
		 SET post_id = ?, status = 'published', published_at = ?, updated_at = ?
		 WHERE id = ?`,
	)
		.bind(postId, publishedAt, now, draftId)
		.run();

	return getLocalDraft(env, draftId);
}

export async function unpublishLocalDraft(env: AppEnv, draftId: string, now = new Date().toISOString()): Promise<LocalDraftRecord | null> {
	const draft = await getLocalDraft(env, draftId);
	if (!draft) {
		return null;
	}
	if (!draft.postId) {
		return draft;
	}

	await env.DB.prepare(
		`UPDATE posts
		 SET visibility = 'archived', updated_at = ?
		 WHERE id = ?
		 AND source_type = 'local'`,
	)
		.bind(now, draft.postId)
		.run();

	await env.DB.prepare(
		`UPDATE post_drafts
		 SET status = 'draft', updated_at = ?
		 WHERE id = ?`,
	)
		.bind(now, draftId)
		.run();

	return getLocalDraft(env, draftId);
}
```

Task 5 extends `publishLocalDraft` to update `post_media` and `album_items`.

- [ ] **Step 4: Wire publish/unpublish routes**

In `workers/api/admin.ts`, import:

```ts
import {
	createLocalDraft,
	getLocalDraft,
	localDraftResponse,
	publishLocalDraft,
	unpublishLocalDraft,
	updateLocalDraft,
} from "../local-posts";
```

Add parser:

```ts
function adminLocalDraftActionPath(
	pathname: string,
): { draftId: string; action: "publish" | "unpublish" } | null {
	const match = /^\/api\/admin\/local-posts\/([^/]+)\/(publish|unpublish)$/.exec(pathname);
	const draftId = match ? decodePathSegment(match[1]) : null;
	return draftId ? { draftId, action: match![2] as "publish" | "unpublish" } : null;
}
```

Add handler:

```ts
async function handleLocalDraftAction(
	request: Request,
	env: AppEnv,
	draftId: string,
	action: "publish" | "unpublish",
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);
	if (session instanceof Response) return session;
	const csrfError = requireCsrf(request, session);
	if (csrfError) return csrfError;

	try {
		const draft =
			action === "publish"
				? await publishLocalDraft(env, draftId)
				: await unpublishLocalDraft(env, draftId);
		return draft
			? json(localDraftResponse(draft))
			: errorJson("NOT_FOUND", "Draft not found", 404);
	} catch (error) {
		return errorJson(
			"BAD_REQUEST",
			error instanceof Error ? error.message : "Draft action failed",
			400,
		);
	}
}
```

In `handleAdminApi`, before plain `adminLocalDraftPath`:

```ts
const localDraftAction = adminLocalDraftActionPath(url.pathname);
if (localDraftAction && request.method === "POST") {
	return handleLocalDraftAction(
		request,
		env,
		localDraftAction.draftId,
		localDraftAction.action,
	);
}
```

- [ ] **Step 5: Run publish tests**

Run:

```bash
npm test -- tests/admin-api.test.ts tests/public-api.test.ts
```

Expected: PASS after helper updates.

- [ ] **Step 6: Commit publish API**

Run:

```bash
git add workers/local-posts.ts workers/api/admin.ts tests/admin-api.test.ts tests/public-api.test.ts
git commit -m "Publish local post drafts"
```

---

### Task 5: Add R2 Image Upload and Album Media Creation

**Files:**
- Modify: `workers/local-posts.ts`
- Modify: `workers/api/admin.ts`
- Modify: `tests/admin-api.test.ts`
- Modify: `tests/local-posts.test.ts`

- [ ] **Step 1: Write upload validation tests**

Add to `tests/local-posts.test.ts`:

```ts
import { validateLocalImageUpload } from "../workers/local-posts";

describe("local post image uploads", () => {
	it("accepts supported image content types", () => {
		expect(validateLocalImageUpload("image/jpeg", 1024)).toEqual("image/jpeg");
		expect(validateLocalImageUpload("image/png", 1024)).toEqual("image/png");
		expect(validateLocalImageUpload("image/webp", 1024)).toEqual("image/webp");
		expect(validateLocalImageUpload("image/gif", 1024)).toEqual("image/gif");
	});

	it("rejects unsupported and oversized image uploads", () => {
		expect(() => validateLocalImageUpload("application/pdf", 1024)).toThrow(
			"Unsupported image type",
		);
		expect(() => validateLocalImageUpload("image/png", 10 * 1024 * 1024 + 1)).toThrow(
			"Image must be at most 10MB",
		);
	});
});
```

Add to `tests/admin-api.test.ts`:

```ts
it("uploads a local post image to R2", async () => {
	const env = sqliteAdminEnv();
	const session = await login(env);
	const body = new Uint8Array([1, 2, 3, 4]).buffer;

	const response = await handleAdminApi(
		adminRequest("/api/admin/uploads", {
			body,
			headers: {
				"x-csrf-token": session.csrfToken,
				cookie: session.cookie,
				"content-type": "image/png",
			},
			method: "POST",
		}),
		env,
	);

	expect(response.status).toBe(200);
	await expect(response.json()).resolves.toMatchObject({
		asset: {
			url: expect.stringContaining("https://assets.233.life/assets/"),
			r2Key: expect.stringContaining("assets/"),
			contentType: "image/png",
			size: 4,
		},
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/local-posts.test.ts tests/admin-api.test.ts
```

Expected: FAIL because upload helpers and `/api/admin/uploads` do not exist.

- [ ] **Step 3: Add upload service**

Extend `workers/local-posts.ts`:

```ts
const maxLocalImageBytes = 10 * 1024 * 1024;
const allowedLocalImageTypes = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
]);

export function validateLocalImageUpload(contentType: string | null, byteLength: number): string {
	const normalized = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
	if (!allowedLocalImageTypes.has(normalized)) {
		throw new Error("Unsupported image type");
	}
	if (byteLength > maxLocalImageBytes) {
		throw new Error("Image must be at most 10MB");
	}
	return normalized;
}

export type LocalImageUploadResult = {
	url: string;
	r2Key: string;
	contentHash: string;
	contentType: string;
	size: number;
};

export async function uploadLocalPostImage(env: AppEnv, request: Request): Promise<LocalImageUploadResult> {
	const bytes = await request.arrayBuffer();
	const contentType = validateLocalImageUpload(request.headers.get("content-type"), bytes.byteLength);
	const contentHash = await contentHashForBytes(bytes);
	const r2Key = buildAssetKey(contentHash, contentType);
	const settingsRow = await env.DB.prepare("SELECT value FROM settings WHERE key = 'cdnBaseUrl' LIMIT 1").first<{ value: string }>();
	const cdnBaseUrl = settingsRow?.value || "https://assets.233.life";
	const url = cdnUrlForKey(cdnBaseUrl, r2Key);
	const now = new Date().toISOString();

	await uploadAssetIfMissing(env.BLOG_ASSETS, r2Key, bytes, {
		contentType,
		cacheControl: "public, max-age=31536000, immutable",
	});

	await env.DB.prepare(
		`INSERT INTO assets (
			id, source_fingerprint, notion_file_json, content_hash, r2_key,
			mime_type, size, cdn_url, created_at, last_seen_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(r2_key) DO UPDATE SET
			content_hash = excluded.content_hash,
			mime_type = excluded.mime_type,
			size = excluded.size,
			cdn_url = excluded.cdn_url,
			last_seen_at = excluded.last_seen_at`,
	)
		.bind(
			crypto.randomUUID(),
			`local-upload:${contentHash}`,
			JSON.stringify({ source: "local-post-upload" }),
			contentHash,
			r2Key,
			contentType,
			bytes.byteLength,
			url,
			now,
			now,
		)
		.run();

	return { url, r2Key, contentHash, contentType, size: bytes.byteLength };
}
```

- [ ] **Step 4: Wire upload route**

In `workers/api/admin.ts`, import `uploadLocalPostImage` and add:

```ts
async function handleUploadLocalPostImage(request: Request, env: AppEnv): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);
	if (session instanceof Response) return session;
	const csrfError = requireCsrf(request, session);
	if (csrfError) return csrfError;

	try {
		return json({ asset: await uploadLocalPostImage(env, request) });
	} catch (error) {
		return errorJson(
			error instanceof Error && error.message.startsWith("Unsupported")
				? "BAD_REQUEST"
				: error instanceof Error && error.message.includes("10MB")
					? "BAD_REQUEST"
					: "R2_UPLOAD_FAILED",
			error instanceof Error ? error.message : "Image upload failed",
			error instanceof Error && (error.message.startsWith("Unsupported") || error.message.includes("10MB")) ? 400 : 500,
		);
	}
}
```

Add in `handleAdminApi`:

```ts
if (url.pathname === "/api/admin/uploads" && request.method === "POST") {
	return handleUploadLocalPostImage(request, env);
}
```

- [ ] **Step 5: Add media and Album writes during publish**

In `workers/local-posts.ts`, add:

```ts
function thumbnailUrlForImage(url: string): string {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}/cdn-cgi/image/width=440,quality=82,format=auto${parsed.pathname}`;
	} catch {
		return url;
	}
}

async function replaceLocalPostMedia(env: AppEnv, postId: string, markdown: string, postTitle: string, publishedAt: string | null, now: string): Promise<void> {
	const urls = extractMarkdownImageUrls(markdown);
	await env.DB.prepare("DELETE FROM post_media WHERE post_id = ?").bind(postId).run();

	for (const [index, url] of urls.entries()) {
		const contentHash = await sha256Hex(`${postId}:${url}:${index}`);
		const mediaId = `local-media:${contentHash}`;
		await env.DB.prepare(
			`INSERT INTO post_media (
				id, post_id, block_id, kind, url, caption, r2_key, content_hash,
				sort_order, created_at, updated_at
			)
			VALUES (?, ?, NULL, 'image', ?, '', NULL, ?, ?, ?, ?)`,
		)
			.bind(mediaId, postId, url, contentHash, index, now, now)
			.run();

		await env.DB.prepare(
			`INSERT INTO album_items (
				id, source_type, source_id, post_id, kind, url, thumbnail_url, large_url,
				r2_key, title, description, caption, taken_at, location_name,
				latitude, longitude, visibility, featured, sort_order,
				source_content_hash, exif_json, created_at, updated_at
			)
			VALUES (?, 'post_media', ?, ?, 'image', ?, ?, ?, NULL, ?, '', '', ?, '',
				NULL, NULL, 'visible', 0, ?, ?, NULL, ?, ?)
			ON CONFLICT(source_type, source_id) DO UPDATE SET
				post_id = excluded.post_id,
				kind = excluded.kind,
				url = excluded.url,
				thumbnail_url = excluded.thumbnail_url,
				large_url = excluded.large_url,
				source_content_hash = excluded.source_content_hash,
				updated_at = excluded.updated_at`,
		)
			.bind(
				`album:${mediaId}`,
				mediaId,
				postId,
				url,
				thumbnailUrlForImage(url),
				url,
				postTitle,
				publishedAt,
				index,
				contentHash,
				now,
				now,
			)
			.run();
	}
}
```

Call this in `publishLocalDraft` after `replacePostTags`:

```ts
await replaceLocalPostMedia(env, postId, input.markdown, input.title, publishedAt, now);
```

- [ ] **Step 6: Run media tests**

Run:

```bash
npm test -- tests/local-posts.test.ts tests/admin-api.test.ts tests/public-api.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit upload and media work**

Run:

```bash
git add workers/local-posts.ts workers/api/admin.ts tests/local-posts.test.ts tests/admin-api.test.ts tests/public-api.test.ts
git commit -m "Add local post image uploads"
```

---

### Task 6: Protect Notion Sync and Source-Aware Admin Posts

**Files:**
- Modify: `workers/sync.ts`
- Modify: `workers/api/admin.ts`
- Modify: `app/components/admin/PostStatusTable.tsx`
- Modify: `tests/sync.test.ts`
- Modify: `tests/admin-api.test.ts`

- [ ] **Step 1: Write sync isolation tests**

Add to `tests/sync.test.ts`:

```ts
it("does not treat local posts as existing Notion sync targets", async () => {
	const db = new SqliteD1Database();
	try {
		db.exec(
			`INSERT INTO posts (
				id, notion_page_id, slug, title, cover_url, status, visibility,
				published_at, notion_last_edited_time, content_hash, last_sync_error,
				created_at, updated_at, excerpt, category, comments_enabled,
				source_type, source_id
			)
			VALUES (
				'local-post', 'local:notion-page-1', 'local-post', 'Local', NULL,
				'local', 'published', '2026-05-26T00:00:00.000Z',
				'2026-05-26T00:00:00.000Z', NULL, NULL,
				'2026-05-26T00:00:00.000Z', '2026-05-26T00:00:00.000Z',
				'', NULL, 1, 'local', 'local-post'
			)`,
		);

		await seedSettings(db);
		await runSync(
			envWithDb(db),
			{
				triggerType: "manual",
				force: true,
				notionPageId: "notion-page-1",
			},
			syncDependencies([
				syncPage({
					id: "notion-page-1",
					last_edited_time: "2026-05-26T01:00:00.000Z",
					properties: {
						Name: {
							type: "title",
							title: [{ plain_text: "Notion Post" }],
						},
						Status: {
							type: "status",
							status: { name: "Published" },
						},
					},
					cover: null,
				}),
			], []),
		);

		expect(db.rows("SELECT source_type, slug FROM posts ORDER BY slug")).toEqual([
			{ source_type: "local", slug: "local-post" },
			{ source_type: "notion", slug: "notion-post" },
		]);
	} finally {
		db.close();
	}
});
```

Add to `tests/admin-api.test.ts`:

```ts
it("rejects resync for local posts", async () => {
	const env = sqliteAdminEnv();
	insertPublicPost(env.DB, {
		id: "local-post",
		notion_page_id: "local:local-post",
		slug: "local-post",
		title: "Local",
		source_type: "local",
		source_id: "local-post",
	});
	const session = await login(env);

	const response = await handleAdminApi(
		adminRequest("/api/admin/posts/local-post/resync", {
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "POST",
		}),
		env,
	);

	expect(response.status).toBe(400);
	await expect(response.json()).resolves.toEqual({
		error: { code: "BAD_REQUEST", message: "Local posts cannot be resynced" },
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/sync.test.ts tests/admin-api.test.ts
```

Expected: FAIL because source filtering and resync rejection are missing.

- [ ] **Step 3: Update sync writes and lookup**

In `workers/sync.ts`, update `ExistingPostState`:

```ts
interface ExistingPostState {
	id: string;
	notion_last_edited_time: string;
	content_hash: string | null;
	slug: string;
	title: string;
	excerpt: string;
	cover_url: string | null;
	category: string | null;
	status: string;
	visibility: PostVisibility;
	published_at: string | null;
	source_type?: "notion" | "local";
}
```

Update `existingPostState` SQL:

```ts
`SELECT
	id, notion_last_edited_time, content_hash, slug, title, excerpt, cover_url,
	category, status, visibility, published_at, source_type
 FROM posts
 WHERE notion_page_id = ?
 AND COALESCE(source_type, 'notion') = 'notion'
 LIMIT 1`
```

Update the post upsert SQL inside sync to include source fields:

```sql
source_type = 'notion',
source_id = excluded.source_id
```

The insert column list must include `source_type, source_id`, and bind:

```ts
"notion",
metadata.notionPageId,
```

- [ ] **Step 4: Make admin posts source-aware**

In `workers/api/admin.ts`, extend `AdminPostRow` and `AdminPostIdentityRow`:

```ts
source_type: "notion" | "local";
source_id: string | null;
```

Update `handleListPosts` SELECT:

```sql
source_type,
source_id,
```

Add to response item:

```ts
sourceType: post.source_type,
sourceId: post.source_id,
```

Update identity query:

```sql
SELECT id, notion_page_id, slug, title, source_type
FROM posts
WHERE id = ?
LIMIT 1
```

Before resync:

```ts
if (action === "resync" && post.source_type === "local") {
	return errorJson("BAD_REQUEST", "Local posts cannot be resynced", 400);
}
```

For delete tombstones, only insert `deleted_posts` for Notion posts:

```ts
if (post.source_type !== "local") {
	await env.DB.prepare(
		`INSERT INTO deleted_posts (
			notion_page_id, post_id, slug, title, deleted_at
		)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(notion_page_id) DO UPDATE SET
			post_id = excluded.post_id,
			slug = excluded.slug,
			title = excluded.title,
			deleted_at = excluded.deleted_at`,
	)
		.bind(post.notion_page_id, post.id, post.slug, post.title, now)
		.run();
}
await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(post.id).run();
```

- [ ] **Step 5: Update admin table type and actions**

In `app/components/admin/PostStatusTable.tsx`, extend `AdminPostRecord`:

```ts
sourceType?: "notion" | "local" | null;
sourceId?: string | null;
```

Where actions are rendered, show `Resync` only for Notion rows:

```tsx
{post.sourceType !== "local" ? (
	<button type="button" onClick={() => void runAction(post, "resync")}>
		Resync
	</button>
) : null}
```

The edit action is added in the editor task.

- [ ] **Step 6: Run sync and admin tests**

Run:

```bash
npm test -- tests/sync.test.ts tests/admin-api.test.ts tests/admin-ui.test.tsx
```

Expected: PASS after updating old test fixtures to include `source_type/source_id` where they assert exact rows.

- [ ] **Step 7: Commit source isolation**

Run:

```bash
git add workers/sync.ts workers/api/admin.ts app/components/admin/PostStatusTable.tsx tests/sync.test.ts tests/admin-api.test.ts tests/admin-ui.test.tsx
git commit -m "Protect local posts from Notion sync"
```

---

### Task 7: Add MDXEditor Admin Writing UI

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `app/components/admin/LocalPostEditor.tsx`
- Modify: `app/components/admin/PostStatusTable.tsx`
- Modify: `app/app.css`
- Modify: `tests/admin-ui.test.tsx`

- [ ] **Step 1: Install MDXEditor**

Run:

```bash
npm install @mdxeditor/editor
```

Expected: `package.json` and `package-lock.json` gain `@mdxeditor/editor`.

- [ ] **Step 2: Write failing admin UI tests**

In `tests/admin-ui.test.tsx`, add tests around `PostStatusTable`:

```tsx
it("opens the local post editor from New post", async () => {
	const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
		if (path === "/api/admin/posts/comment-settings") {
			return Promise.resolve({
				defaultEnabled: true,
				globalEnabled: true,
				moderationEnabled: false,
			});
		}
		if (path.startsWith("/api/admin/posts")) {
			return Promise.resolve({ items: [], total: 0, page: 1, limit: 20 });
		}
		if (path === "/api/admin/local-posts/draft-1") {
			return Promise.resolve({
				draft: {
					id: "draft-1",
					postId: null,
					title: "Untitled",
					slug: null,
					excerpt: "",
					markdown: "",
					coverUrl: null,
					category: null,
					tags: [],
					status: "draft",
					commentsEnabled: true,
					publishedAt: null,
					createdAt: "2026-05-26T00:00:00.000Z",
					updatedAt: "2026-05-26T00:00:00.000Z",
				},
			});
		}
		return Promise.reject(new Error(`Unexpected GET ${path}`));
	});
	const apiPost = vi.spyOn(apiClient, "apiPost").mockResolvedValue({
		draft: { id: "draft-1" },
	});
	try {
		render(<PostStatusTable csrfToken="csrf" />);
		fireEvent.click(await screen.findByRole("button", { name: "New post" }));
		expect(await screen.findByRole("heading", { name: "Write post" })).toBeTruthy();
	} finally {
		apiGet.mockRestore();
		apiPost.mockRestore();
	}
});
```

- [ ] **Step 3: Run UI tests to verify they fail**

Run:

```bash
npm test -- tests/admin-ui.test.tsx
```

Expected: FAIL because editor UI does not exist.

- [ ] **Step 4: Create the editor component**

Create `app/components/admin/LocalPostEditor.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import {
	BoldItalicUnderlineToggles,
	CreateLink,
	InsertImage,
	InsertThematicBreak,
	ListsToggle,
	MDXEditor,
	type MDXEditorMethods,
	UndoRedo,
	headingsPlugin,
	imagePlugin,
	linkPlugin,
	listsPlugin,
	quotePlugin,
	thematicBreakPlugin,
	toolbarPlugin,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { apiGet, apiPost, apiPut } from "../../lib/api-client";

type LocalDraft = {
	id: string;
	postId: string | null;
	title: string;
	slug: string | null;
	excerpt: string;
	markdown: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	status: "draft" | "published" | "archived";
	commentsEnabled: boolean | null;
	publishedAt: string | null;
};

type DraftResponse = { draft: LocalDraft };
type UploadResponse = {
	asset: { url: string; r2Key: string; contentType: string; size: number };
};

export function LocalPostEditor({
	draftId,
	csrfToken,
	onClose,
	onPublished,
}: {
	draftId: string;
	csrfToken: string;
	onClose: () => void;
	onPublished: () => void;
}) {
	const editorRef = useRef<MDXEditorMethods>(null);
	const [draft, setDraft] = useState<LocalDraft | null>(null);
	const [title, setTitle] = useState("");
	const [slug, setSlug] = useState("");
	const [excerpt, setExcerpt] = useState("");
	const [coverUrl, setCoverUrl] = useState("");
	const [category, setCategory] = useState("");
	const [tags, setTags] = useState("");
	const [commentsEnabled, setCommentsEnabled] = useState(true);
	const [publishedAt, setPublishedAt] = useState("");
	const [status, setStatus] = useState("Loading draft...");
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		let cancelled = false;
		apiGet<DraftResponse>(`/api/admin/local-posts/${encodeURIComponent(draftId)}`)
			.then((response) => {
				if (cancelled) return;
				setDraft(response.draft);
				setTitle(response.draft.title);
				setSlug(response.draft.slug ?? "");
				setExcerpt(response.draft.excerpt);
				setCoverUrl(response.draft.coverUrl ?? "");
				setCategory(response.draft.category ?? "");
				setTags(response.draft.tags.join(", "));
				setCommentsEnabled(response.draft.commentsEnabled !== false);
				setPublishedAt(response.draft.publishedAt ?? "");
				editorRef.current?.setMarkdown(response.draft.markdown);
				setStatus("Draft loaded.");
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setStatus(error instanceof Error ? error.message : "Draft could not be loaded.");
				}
			});
		return () => {
			cancelled = true;
		};
	}, [draftId]);

	function draftPayload() {
		return {
			title,
			slug,
			excerpt,
			markdown: editorRef.current?.getMarkdown() ?? draft?.markdown ?? "",
			coverUrl,
			category,
			tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
			commentsEnabled,
			publishedAt: publishedAt || null,
		};
	}

	async function saveDraft() {
		setSaving(true);
		setStatus("Saving draft...");
		try {
			const response = await apiPut<DraftResponse>(
				`/api/admin/local-posts/${encodeURIComponent(draftId)}`,
				draftPayload(),
				csrfToken,
			);
			setDraft(response.draft);
			setStatus("Draft saved.");
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Draft could not be saved.");
		} finally {
			setSaving(false);
		}
	}

	async function publishDraft() {
		await saveDraft();
		setSaving(true);
		setStatus("Publishing...");
		try {
			const response = await apiPost<DraftResponse>(
				`/api/admin/local-posts/${encodeURIComponent(draftId)}/publish`,
				{},
				csrfToken,
			);
			setDraft(response.draft);
			setStatus("Published.");
			onPublished();
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Draft could not be published.");
		} finally {
			setSaving(false);
		}
	}

	async function uploadImage(file: File): Promise<string> {
		const response = await fetch("/api/admin/uploads", {
			body: file,
			credentials: "same-origin",
			headers: {
				"content-type": file.type,
				"x-csrf-token": csrfToken,
			},
			method: "POST",
		});
		if (!response.ok) {
			throw new Error("Image upload failed");
		}
		const body = (await response.json()) as UploadResponse;
		return body.asset.url;
	}

	return (
		<div className="admin-stack local-editor">
			<div className="admin-section-heading">
				<div>
					<h2>Write post</h2>
					<p className="admin-note">{status}</p>
				</div>
				<div className="admin-inline-actions">
					<button type="button" className="admin-secondary-button" onClick={onClose}>
						Back
					</button>
					<button type="button" onClick={() => void saveDraft()} disabled={saving}>
						Save draft
					</button>
					<button type="button" onClick={() => void publishDraft()} disabled={saving}>
						Publish
					</button>
				</div>
			</div>
			<div className="local-editor-grid">
				<label>
					Title
					<input value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
				</label>
				<label>
					Slug
					<input value={slug} onChange={(event) => setSlug(event.currentTarget.value)} />
				</label>
				<label>
					Excerpt
					<textarea value={excerpt} onChange={(event) => setExcerpt(event.currentTarget.value)} />
				</label>
				<label>
					Cover URL
					<input value={coverUrl} onChange={(event) => setCoverUrl(event.currentTarget.value)} />
				</label>
				<label>
					Category
					<input value={category} onChange={(event) => setCategory(event.currentTarget.value)} />
				</label>
				<label>
					Tags
					<input value={tags} onChange={(event) => setTags(event.currentTarget.value)} />
				</label>
				<label>
					Published at
					<input value={publishedAt} onChange={(event) => setPublishedAt(event.currentTarget.value)} placeholder="2026-05-26T00:00:00.000Z" />
				</label>
				<label className="admin-checkbox-row">
					<input type="checkbox" checked={commentsEnabled} onChange={(event) => setCommentsEnabled(event.currentTarget.checked)} />
					Comments
				</label>
			</div>
			<div className="local-editor-surface">
				<MDXEditor
					ref={editorRef}
					markdown={draft?.markdown ?? ""}
					plugins={[
						headingsPlugin(),
						listsPlugin(),
						quotePlugin(),
						linkPlugin(),
						thematicBreakPlugin(),
						imagePlugin({ imageUploadHandler: uploadImage }),
						toolbarPlugin({
							toolbarContents: () => (
								<>
									<UndoRedo />
									<BoldItalicUnderlineToggles />
									<ListsToggle />
									<CreateLink />
									<InsertImage />
									<InsertThematicBreak />
								</>
							),
						}),
					]}
				/>
			</div>
		</div>
	);
}
```

- [ ] **Step 5: Integrate editor in Posts table**

In `PostStatusTable.tsx`, import:

```ts
import { LocalPostEditor } from "./LocalPostEditor";
```

Add state:

```ts
const [editorDraftId, setEditorDraftId] = useState<string | null>(null);
```

Add create function:

```ts
async function createLocalPost() {
	setActionPending("local:create");
	setError(null);
	try {
		const response = await apiPost<{ draft: { id: string } }>(
			"/api/admin/local-posts",
			{ title: "Untitled" },
			csrfToken,
		);
		setEditorDraftId(response.draft.id);
	} catch (error) {
		setError(error instanceof Error ? error.message : "Draft could not be created.");
	} finally {
		setActionPending(null);
	}
}
```

If `editorDraftId` is set, render the editor before the table:

```tsx
if (editorDraftId) {
	return (
		<LocalPostEditor
			draftId={editorDraftId}
			csrfToken={csrfToken}
			onClose={() => setEditorDraftId(null)}
			onPublished={() => {
				setEditorDraftId(null);
				setPage(1);
				setToast("Post published.");
			}}
		/>
	);
}
```

Add `New post` button in the table header controls:

```tsx
<button type="button" onClick={() => void createLocalPost()} disabled={actionPending === "local:create"}>
	New post
</button>
```

Do not add the `Edit` action in this task. Task 8 adds edit support after the API can create or load a draft from an existing local post.

- [ ] **Step 6: Add editor styles**

In `app/app.css`, add:

```css
.local-editor {
	gap: 20px;
}

.local-editor-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 14px;
}

.local-editor-grid label {
	min-width: 0;
}

.local-editor-grid textarea {
	min-height: 92px;
	resize: vertical;
}

.local-editor-surface {
	border: 1px solid var(--admin-border, rgba(0, 0, 0, 0.14));
	border-radius: 8px;
	background: var(--admin-surface, #fff);
	overflow: hidden;
}

.local-editor-surface .mdxeditor {
	min-height: 520px;
}

.admin-inline-actions {
	display: flex;
	align-items: center;
	gap: 10px;
	flex-wrap: wrap;
}

@media (max-width: 720px) {
	.local-editor-grid {
		grid-template-columns: 1fr;
	}
}
```

- [ ] **Step 7: Run UI tests**

Run:

```bash
npm test -- tests/admin-ui.test.tsx
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit editor UI**

Run:

```bash
git add package.json package-lock.json app/components/admin/LocalPostEditor.tsx app/components/admin/PostStatusTable.tsx app/app.css tests/admin-ui.test.tsx
git commit -m "Add native Markdown post editor"
```

---

### Task 8: Edit Published Local Posts and Expose Source Type

**Files:**
- Modify: `workers/local-posts.ts`
- Modify: `workers/api/admin.ts`
- Modify: `workers/db/d1.ts`
- Modify: `app/components/admin/PostStatusTable.tsx`
- Modify: `tests/admin-api.test.ts`
- Modify: `tests/public-api.test.ts`
- Modify: `tests/admin-ui.test.tsx`

- [ ] **Step 1: Write edit-from-published tests**

Add to `tests/admin-api.test.ts`:

```ts
it("creates or returns a draft for an existing local post", async () => {
	const env = sqliteAdminEnv();
	const session = await login(env);
	insertPublishedLocalPostWithContent(env.DB, {
		id: "local-post",
		slug: "local-post",
		title: "Local post",
		markdown: "Published body",
	});

	const response = await handleAdminApi(
		adminRequest("/api/admin/local-posts", {
			body: JSON.stringify({ postId: "local-post" }),
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "POST",
		}),
		env,
	);

	expect(response.status).toBe(200);
	await expect(response.json()).resolves.toMatchObject({
		draft: {
			postId: "local-post",
			title: "Local post",
			markdown: "Published body",
		},
	});
});

it("rejects creating an editor draft from a Notion post", async () => {
	const env = sqliteAdminEnv();
	const session = await login(env);
	insertPublicPost(env.DB, {
		id: "notion-post",
		slug: "notion-post",
		title: "Notion",
		source_type: "notion",
		source_id: "notion-page",
	});

	const response = await handleAdminApi(
		adminRequest("/api/admin/local-posts", {
			body: JSON.stringify({ postId: "notion-post" }),
			headers: { ...csrfHeaders(session.csrfToken), cookie: session.cookie },
			method: "POST",
		}),
		env,
	);

	expect(response.status).toBe(400);
	await expect(response.json()).resolves.toEqual({
		error: { code: "BAD_REQUEST", message: "Only local posts can be edited" },
	});
});
```

Add to `tests/admin-ui.test.tsx`:

```tsx
it("shows Edit only for local posts", async () => {
	const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
		if (path === "/api/admin/posts/comment-settings") {
			return Promise.resolve({
				defaultEnabled: true,
				globalEnabled: true,
				moderationEnabled: false,
			});
		}
		if (path.startsWith("/api/admin/posts")) {
			return Promise.resolve({
				items: [
					{
						id: "notion-1",
						title: "Notion",
						slug: "notion",
						sourceType: "notion",
					},
					{
						id: "local-1",
						title: "Local",
						slug: "local",
						sourceType: "local",
					},
				],
				total: 2,
				page: 1,
				limit: 20,
			});
		}
		return Promise.reject(new Error(`Unexpected GET ${path}`));
	});

	try {
		render(<PostStatusTable csrfToken="csrf" />);
		expect(await screen.findByText("Local")).toBeTruthy();
		expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
	} finally {
		apiGet.mockRestore();
	}
});
```

Add to `tests/public-api.test.ts`:

```ts
it("includes sourceType for public post list and detail records", async () => {
	const db = new SqliteD1Database();
	db.insertPost({
		id: "local-post",
		notion_page_id: "local:local-post",
		slug: "local-post",
		title: "Local",
		excerpt: "Local excerpt",
		cover_url: null,
		category: "Life",
		status: "local",
		visibility: "published",
		published_at: "2026-05-26T00:00:00.000Z",
		notion_last_edited_time: "2026-05-26T00:00:00.000Z",
		content_hash: "hash",
		last_sync_error: null,
		created_at: "2026-05-26T00:00:00.000Z",
		updated_at: "2026-05-26T00:00:00.000Z",
		source_type: "local",
		source_id: "local-post",
	});
	db.insertContent("local-post", "Local body");

	const response = await handlePublicApi(
		new Request("https://example.test/api/posts"),
		envWithDb(db.asD1()),
	);

	expect(response.status).toBe(200);
	await expect(response.json()).resolves.toMatchObject({
		items: [expect.objectContaining({ sourceType: "local" })],
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/admin-api.test.ts tests/public-api.test.ts
```

Expected: FAIL because `postId` draft creation and public `sourceType` mapping are incomplete.

- [ ] **Step 3: Add draft-from-post service**

In `workers/local-posts.ts`, add:

```ts
type LocalPostWithContentRow = {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	cover_url: string | null;
	category: string | null;
	comments_enabled: number;
	published_at: string | null;
	source_type: PostSourceType;
	markdown: string;
};

async function tagsForPost(env: AppEnv, postId: string): Promise<string[]> {
	const result = await env.DB.prepare(
		`SELECT tag
		 FROM post_tags
		 WHERE post_id = ?
		 ORDER BY sort_order ASC, tag ASC`,
	)
		.bind(postId)
		.all<{ tag: string }>();
	return result.results.map((row) => row.tag);
}

export async function createOrLoadDraftForLocalPost(env: AppEnv, postId: string, now = new Date().toISOString()): Promise<LocalDraftRecord> {
	const existingDraft = await env.DB.prepare(
		`SELECT
			id, post_id, title, slug, excerpt, markdown, cover_url, category,
			tags_json, status, comments_enabled, published_at, created_at, updated_at
		 FROM post_drafts
		 WHERE post_id = ?
		 ORDER BY updated_at DESC
		 LIMIT 1`,
	)
		.bind(postId)
		.first<LocalDraftRow>();
	if (existingDraft) {
		return mapDraftRow(existingDraft);
	}

	const post = await env.DB.prepare(
		`SELECT
			p.id, p.slug, p.title, p.excerpt, p.cover_url, p.category,
			p.comments_enabled, p.published_at, p.source_type, pc.markdown
		 FROM posts p
		 JOIN post_content pc ON pc.post_id = p.id
		 WHERE p.id = ?
		 LIMIT 1`,
	)
		.bind(postId)
		.first<LocalPostWithContentRow>();
	if (!post) {
		throw new Error("Post not found");
	}
	if (post.source_type !== "local") {
		throw new Error("Only local posts can be edited");
	}

	const id = crypto.randomUUID();
	const tags = await tagsForPost(env, post.id);
	await env.DB.prepare(
		`INSERT INTO post_drafts (
			id, post_id, title, slug, excerpt, markdown, cover_url, category,
			tags_json, status, comments_enabled, published_at, created_at, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?, ?)`,
	)
		.bind(
			id,
			post.id,
			post.title,
			post.slug,
			post.excerpt,
			post.markdown,
			post.cover_url,
			post.category,
			JSON.stringify(tags),
			post.comments_enabled,
			post.published_at,
			now,
			now,
		)
		.run();

	const draft = await getLocalDraft(env, id);
	if (!draft) {
		throw new Error("Draft could not be loaded after creation");
	}
	return draft;
}
```

Update `handleCreateLocalDraft` so `{ postId }` calls `createOrLoadDraftForLocalPost`.

- [ ] **Step 4: Expose `sourceType` in public repository**

In `workers/db/d1.ts`, update `PostRow`:

```ts
source_type?: "notion" | "local";
```

Update `publicPostColumnNames`:

```ts
const publicPostColumnNames = [
	"id",
	"slug",
	"title",
	"excerpt",
	"cover_url",
	"category",
	"status",
	"visibility",
	"source_type",
	"locked",
	"comments_enabled",
	"published_at",
	"updated_at",
] as const;
```

Update `mapPostRow`:

```ts
sourceType: row.source_type ?? "notion",
```

- [ ] **Step 5: Implement edit action in admin UI**

In `PostStatusTable.tsx`, add:

```ts
async function editLocalPost(post: AdminPostRecord) {
	setActionPending(`${post.id}:edit`);
	setError(null);
	try {
		const response = await apiPost<{ draft: { id: string } }>(
			"/api/admin/local-posts",
			{ postId: post.id },
			csrfToken,
		);
		setEditorDraftId(response.draft.id);
	} catch (error) {
		setError(error instanceof Error ? error.message : "Editor draft could not be opened.");
	} finally {
		setActionPending(null);
	}
}
```

Use the `Edit` button from Task 7:

```tsx
{post.sourceType === "local" ? (
	<button type="button" onClick={() => void editLocalPost(post)}>
		Edit
	</button>
) : null}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- tests/admin-api.test.ts tests/public-api.test.ts tests/admin-ui.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit edit/source work**

Run:

```bash
git add workers/local-posts.ts workers/api/admin.ts workers/db/d1.ts app/components/admin/PostStatusTable.tsx tests/admin-api.test.ts tests/public-api.test.ts tests/admin-ui.test.tsx
git commit -m "Support editing published local posts"
```

---

### Task 9: Final Verification and Build

**Files:**
- Modify only if verification exposes small issues.

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Build production assets**

Run:

```bash
npm run build
```

Expected: PASS. Check that MDXEditor is only included in the admin chunk, not the public home chunk.

- [ ] **Step 4: Run Cloudflare dry run**

Run:

```bash
npm run check
```

Expected: PASS. `wrangler deploy --dry-run` should complete without Worker syntax or binding errors.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short --branch
```

Expected: clean working tree and branch ahead by the task commits.

- [ ] **Step 6: Commit verification fixes when files changed**

Run:

```bash
git diff --name-only
```

If the command prints file paths, stage those exact files and commit:

```bash
git add $(git diff --name-only)
git commit -m "Stabilize native post authoring"
```

If the command prints no file paths, no verification commit is needed.
