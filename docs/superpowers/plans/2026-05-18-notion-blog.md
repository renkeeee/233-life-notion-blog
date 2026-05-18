# Notion Blog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an API-first Cloudflare Notion blog with encrypted admin configuration, D1 persistence, R2 asset caching, nightly/manual sync, and public blog pages.

**Architecture:** The frontend is a Vite React SPA using React Router as a browser-side routing library, and it fetches all business data from Worker JSON APIs under `/api/*`. The Worker owns authentication, settings, Notion sync, D1 repositories, and R2 uploads. Pure modules are tested first; Worker/API glue stays thin.

**Tech Stack:** Vite, React Router 7.9 as a client library, React 19, TypeScript, Cloudflare Workers, D1, R2, Cron Triggers, Tailwind CSS 4, Vitest, Web Crypto.

**Architecture Correction:** Cloudflare's React Router framework guide states that React Router framework SPA mode and prerendering are not currently supported with the Cloudflare Vite plugin. Implementation therefore uses the official Cloudflare Vite plugin "React SPA with an API Worker" shape: `@vitejs/plugin-react`, static asset SPA fallback, and `assets.run_worker_first` for `/api` and `/api/*`.

---

## File Structure

- Modify `package.json` and `package-lock.json`: add Vitest scripts and test dependencies.
- Create `vitest.config.ts`: Node/jsdom test configuration.
- Create `index.html`, `app/main.tsx`, and `app/App.tsx`: Vite SPA entry and browser route tree.
- Modify `vite.config.ts`: use `@vitejs/plugin-react` with the Cloudflare Vite plugin.
- Replace `app/routes/home.tsx`: public blog home route component using client-side fetch.
- Create `app/routes/post.tsx`, `app/routes/tag.tsx`, `app/routes/search.tsx`, `app/routes/admin.tsx`: SPA route entries.
- Create `app/components/public/*`: public blog components.
- Create `app/components/admin/*`: admin console components.
- Create `app/lib/api-client.ts`: typed browser API helper.
- Create `app/lib/markdown.tsx`: Markdown rendering helper.
- Modify `index.html`, `app/App.tsx`, and `app/app.css`: app shell metadata and responsive styles.
- Modify `workers/app.ts`: route `/api` and `/api/*`; static asset SPA fallback handles browser navigations.
- Create `workers/types.ts`: shared Worker environment, API, and domain types.
- Create `workers/http.ts`: JSON responses, routing, request parsing, error shape.
- Create `workers/crypto.ts`: hashing, password hashing, config encryption, session signing.
- Create `workers/cookies.ts`: cookie parsing and session cookie helpers.
- Create `workers/db/schema.sql`: D1 schema used by migrations and local reset.
- Create `migrations/0001_initial.sql`: initial D1 migration.
- Create `workers/db/d1.ts`: D1 repository implementations.
- Create `workers/settings.ts`: settings read/write with encryption.
- Create `workers/auth.ts`: password bootstrap, login, session, CSRF checks.
- Create `workers/notion/client.ts`: direct Notion API fetch client.
- Create `workers/notion/database.ts`: database URL parsing and field mapping inference.
- Create `workers/notion/blocks.ts`: block normalization and Markdown conversion.
- Create `workers/assets.ts`: asset download, content hashing, R2 upload, CDN URL generation.
- Create `workers/sync.ts`: nightly/manual sync orchestration.
- Create `workers/api/public.ts`: public post, tag, and search endpoints.
- Create `workers/api/admin.ts`: admin auth, settings, schema, sync, run detail, and post status endpoints.
- Create `tests/**/*`: focused tests for each pure module and API handler.

## Task 1: Test Harness and SPA Mode

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vite.config.ts`
- Modify: `wrangler.json`
- Modify: `workers/app.ts`
- Modify: `app/routes/home.tsx`
- Create: `index.html`
- Create: `app/main.tsx`
- Create: `app/App.tsx`
- Create: `app/routes/post.tsx`
- Create: `app/routes/tag.tsx`
- Create: `app/routes/search.tsx`
- Create: `app/routes/admin.tsx`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `tests/notion-database.test.ts`
- Create: `tests/worker-app.test.ts`
- Create: `tsconfig.test.json`

- [ ] **Step 1: Install test dependencies**

Run:

```bash
npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom
```

Expected: `package.json` and `package-lock.json` include the new dev dependencies.

- [ ] **Step 2: Add test scripts**

Update `package.json` scripts to include:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

Keep existing scripts unchanged.

- [ ] **Step 3: Create Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		environment: "jsdom",
		globals: true,
		include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
	},
});
```

- [ ] **Step 4: Write the first failing test**

Create `tests/notion-database.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseNotionDatabaseId } from "../workers/notion/database";

describe("parseNotionDatabaseId", () => {
	it("extracts a 32-character Notion database id from a shared Notion URL", () => {
		expect(
			parseNotionDatabaseId(
				"https://www.notion.so/renke-me/c5e926f6cd3c4671bb0b86737143570b",
			),
		).toBe("c5e926f6cd3c4671bb0b86737143570b");
	});
});
```

- [ ] **Step 5: Run the test and verify RED**

Run:

```bash
npm test -- tests/notion-database.test.ts
```

Expected: FAIL because `workers/notion/database` does not exist.

- [ ] **Step 6: Switch to Vite React SPA and API Worker**

Install the React Vite plugin:

```bash
npm install -D @vitejs/plugin-react
```

Update scripts:

```json
{
  "build": "vite build",
  "cf-typegen": "wrangler types",
  "check": "tsc -b && vite build && wrangler deploy --dry-run",
  "dev": "vite dev",
  "typecheck": "tsc -b"
}
```

Modify `vite.config.ts`:

```ts
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	plugins: [react(), tailwindcss(), cloudflare(), tsconfigPaths()],
});
```

Modify `wrangler.json`:

```json
{
	"$schema": "./node_modules/wrangler/config-schema.json",
	"name": "233-life-notion-blog",
	"main": "./workers/app.ts",
	"compatibility_date": "2025-10-08",
	"compatibility_flags": ["nodejs_compat"],
	"assets": {
		"not_found_handling": "single-page-application",
		"run_worker_first": ["/api", "/api/*"]
	},
	"observability": {
		"enabled": true
	},
	"upload_source_maps": true,
	"vars": {
		"VALUE_FROM_CLOUDFLARE": "Hello from Cloudflare"
	}
}
```

Create `index.html`, `app/main.tsx`, and `app/App.tsx`. `App.tsx` should use `BrowserRouter`, `Routes`, and `Route` from `react-router` as a browser-side library, not the React Router framework.

Replace `app/routes/home.tsx` with a loader-free component:

```tsx
export default function Home() {
	return <main className="mx-auto max-w-5xl px-4 py-10">Loading posts...</main>;
}
```

Create minimal loader-free route components for `post`, `tag`, `search`, and `admin`.

Replace `workers/app.ts` with a plain Worker API entry:

```ts
function json(data: unknown, init?: ResponseInit) {
	const headers = new Headers(init?.headers);
	if (!headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}

	return Response.json(data, {
		...init,
		headers,
	});
}

export default {
	fetch(request) {
		const url = new URL(request.url);

		if (url.pathname === "/api/health") {
			return json({ ok: true });
		}

		if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
			return json({ error: "Not found" }, { status: 404 });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
```

Remove framework-only files: `react-router.config.ts`, `app/routes.ts`, `app/root.tsx`, and `app/entry.server.tsx`.

- [ ] **Step 7: Add minimal parser implementation**

Create `workers/notion/database.ts`:

```ts
export function parseNotionDatabaseId(input: string): string {
	const compact = input.replaceAll("-", "");
	const match = compact.match(/[0-9a-fA-F]{32}/);
	if (!match) {
		throw new Error("Invalid Notion database URL or id");
	}
	return match[0].toLowerCase();
}
```

- [ ] **Step 8: Add Worker routing tests and verify GREEN**

Create `tests/worker-app.test.ts` to verify `/api/health`, unknown `/api/*`, `/api`, and non-API requests. Add `tsconfig.test.json`, reference it from `tsconfig.json`, and wire `tests/setup.ts` into `vitest.config.ts` so tests are typechecked by `npm run check`.

Run:

```bash
npm test -- tests/notion-database.test.ts tests/worker-app.test.ts
npm run build
npm run check
```

Expected: tests pass, Vite build succeeds, and Wrangler dry-run succeeds.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vite.config.ts wrangler.json tsconfig.json tsconfig.test.json vitest.config.ts tests/setup.ts index.html app workers tests
git commit -m "chore: add test harness and spa routes"
```

## Task 2: Cloudflare Bindings and D1 Schema

**Files:**
- Modify: `wrangler.json`
- Create: `workers/types.ts`
- Create: `workers/db/schema.sql`
- Create: `migrations/0001_initial.sql`
- Create: `tests/schema.test.ts`

- [ ] **Step 1: Write schema test**

Create `tests/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import schemaSql from "../workers/db/schema.sql?raw";

describe("D1 schema", () => {
	it("defines the tables required by the Notion blog design", () => {
		for (const table of [
			"settings",
			"posts",
			"post_content",
			"assets",
			"sync_runs",
			"sync_items",
		]) {
			expect(schemaSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
		}
	});
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test -- tests/schema.test.ts
```

Expected: FAIL because `workers/db/schema.sql` does not exist.

- [ ] **Step 3: Create schema**

Create `workers/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	encrypted INTEGER NOT NULL DEFAULT 0,
	updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
	id TEXT PRIMARY KEY,
	notion_page_id TEXT NOT NULL UNIQUE,
	slug TEXT NOT NULL UNIQUE,
	title TEXT NOT NULL,
	summary TEXT,
	cover_url TEXT,
	tags_json TEXT NOT NULL DEFAULT '[]',
	status TEXT NOT NULL,
	visibility TEXT NOT NULL CHECK (visibility IN ('published', 'hidden', 'archived')),
	published_at TEXT,
	notion_last_edited_time TEXT NOT NULL,
	content_hash TEXT,
	last_sync_error TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_visibility_published_at
	ON posts (visibility, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_notion_last_edited_time
	ON posts (notion_last_edited_time);

CREATE TABLE IF NOT EXISTS post_content (
	post_id TEXT PRIMARY KEY,
	markdown TEXT NOT NULL,
	block_snapshot_hash TEXT NOT NULL,
	content_hash TEXT NOT NULL,
	resource_refs_json TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assets (
	id TEXT PRIMARY KEY,
	source_fingerprint TEXT NOT NULL UNIQUE,
	notion_file_json TEXT,
	content_hash TEXT NOT NULL,
	r2_key TEXT NOT NULL UNIQUE,
	mime_type TEXT,
	size INTEGER,
	cdn_url TEXT NOT NULL,
	created_at TEXT NOT NULL,
	last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assets_content_hash
	ON assets (content_hash);

CREATE TABLE IF NOT EXISTS sync_runs (
	id TEXT PRIMARY KEY,
	trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron', 'manual')),
	started_at TEXT NOT NULL,
	finished_at TEXT,
	status TEXT NOT NULL CHECK (status IN ('running', 'success', 'partial', 'failed')),
	range_start TEXT,
	range_end TEXT,
	force INTEGER NOT NULL DEFAULT 0,
	created_count INTEGER NOT NULL DEFAULT 0,
	updated_count INTEGER NOT NULL DEFAULT 0,
	metadata_only_count INTEGER NOT NULL DEFAULT 0,
	skipped_count INTEGER NOT NULL DEFAULT 0,
	unpublished_count INTEGER NOT NULL DEFAULT 0,
	archived_count INTEGER NOT NULL DEFAULT 0,
	failed_count INTEGER NOT NULL DEFAULT 0,
	error_code TEXT,
	error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_started_at
	ON sync_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS sync_items (
	id TEXT PRIMARY KEY,
	sync_run_id TEXT NOT NULL,
	notion_page_id TEXT NOT NULL,
	post_id TEXT,
	action TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('success', 'skipped', 'failed')),
	error_code TEXT,
	error_message TEXT,
	started_at TEXT NOT NULL,
	finished_at TEXT,
	FOREIGN KEY (sync_run_id) REFERENCES sync_runs(id) ON DELETE CASCADE,
	FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_items_run_id
	ON sync_items (sync_run_id);
```

Create `migrations/0001_initial.sql` with the same SQL content.

- [ ] **Step 4: Add Worker types**

Create `workers/types.ts`:

```ts
export interface AppEnv {
	ASSETS: {
		fetch(request: Request): Promise<Response>;
	};
	DB: D1Database;
	BLOG_ASSETS: R2Bucket;
	CONFIG_ENCRYPTION_KEY: string;
	VALUE_FROM_CLOUDFLARE?: string;
}

export type ApiErrorCode =
	| "BAD_REQUEST"
	| "UNAUTHORIZED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "NOTION_AUTH_FAILED"
	| "NOTION_DATABASE_NOT_FOUND"
	| "FIELD_MAPPING_INVALID"
	| "NOTION_RATE_LIMITED"
	| "ASSET_DOWNLOAD_FAILED"
	| "R2_UPLOAD_FAILED"
	| "CONFIG_DECRYPT_FAILED"
	| "SYNC_ALREADY_RUNNING";

export interface ApiErrorBody {
	error: {
		code: ApiErrorCode;
		message: string;
	};
}

export interface FieldMapping {
	title: string;
	slug?: string;
	summary?: string;
	tags?: string;
	status: string;
	publishedAt?: string;
	cover?: string;
}

export interface SiteSettings {
	siteTitle: string;
	notionDatabaseUrl: string;
	notionDatabaseId: string;
	notionToken: string;
	cdnBaseUrl: string;
	fieldMapping: FieldMapping;
}
```

- [ ] **Step 5: Create Cloudflare resources and add bindings**

Run the Cloudflare resource commands first:

```bash
npx wrangler d1 create 233-life-notion-blog
npx wrangler r2 bucket create 233-life-notion-blog-assets
```

Expected: Wrangler prints a D1 UUID for `233-life-notion-blog`, and the R2 bucket command succeeds or reports that the bucket already exists.

Modify `wrangler.json` with the D1 and R2 bindings:

```json
{
	"$schema": "./node_modules/wrangler/config-schema.json",
	"name": "233-life-notion-blog",
	"main": "./workers/app.ts",
	"compatibility_date": "2025-10-08",
	"compatibility_flags": ["nodejs_compat"],
	"observability": {
		"enabled": true
	},
	"upload_source_maps": true,
	"vars": {
		"VALUE_FROM_CLOUDFLARE": "Hello from Cloudflare"
	},
	"d1_databases": [
		{
			"binding": "DB",
			"database_name": "233-life-notion-blog"
		}
	],
	"r2_buckets": [
		{
			"binding": "BLOG_ASSETS",
			"bucket_name": "233-life-notion-blog-assets"
		}
	],
	"triggers": {
		"crons": ["0 18 * * *"]
	}
}
```

`database_id` is optional in the local Wrangler schema. Add the generated D1 UUID before production deploy if Wrangler requires it for the target account. The cron expression runs at 02:00 Asia/Shanghai because Cloudflare Cron uses UTC.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm test -- tests/schema.test.ts
npm run cf-typegen
npm run build
```

Expected: schema test passes; type generation includes `DB` and `BLOG_ASSETS`; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add wrangler.json worker-configuration.d.ts workers/types.ts workers/db/schema.sql migrations/0001_initial.sql tests/schema.test.ts
git commit -m "feat: add cloudflare storage bindings and schema"
```

## Task 3: Core HTTP, Crypto, and Cookie Utilities

**Files:**
- Create: `workers/http.ts`
- Create: `workers/crypto.ts`
- Create: `workers/cookies.ts`
- Create: `tests/http.test.ts`
- Create: `tests/crypto.test.ts`
- Create: `tests/cookies.test.ts`

- [ ] **Step 1: Write failing utility tests**

Create `tests/http.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { errorJson, json } from "../workers/http";

describe("http helpers", () => {
	it("returns JSON responses", async () => {
		const response = json({ ok: true }, 201);
		expect(response.status).toBe(201);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({ ok: true });
	});

	it("returns the standard error shape", async () => {
		const response = errorJson("BAD_REQUEST", "Invalid body", 400);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: "BAD_REQUEST", message: "Invalid body" },
		});
	});
});
```

Create `tests/crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	decryptString,
	encryptString,
	hashPassword,
	sha256Hex,
	verifyPassword,
} from "../workers/crypto";

describe("crypto helpers", () => {
	it("creates stable SHA-256 hex hashes", async () => {
		expect(await sha256Hex("hello")).toBe(
			"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		);
	});

	it("hashes and verifies passwords", async () => {
		const hash = await hashPassword("123456");
		expect(hash).not.toContain("123456");
		expect(await verifyPassword("123456", hash)).toBe(true);
		expect(await verifyPassword("bad", hash)).toBe(false);
	});

	it("encrypts and decrypts config strings", async () => {
		const encrypted = await encryptString("secret-value", "root-key");
		expect(encrypted).not.toContain("secret-value");
		expect(await decryptString(encrypted, "root-key")).toBe("secret-value");
	});
});
```

Create `tests/cookies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseCookies, serializeCookie } from "../workers/cookies";

describe("cookie helpers", () => {
	it("parses cookies from a request header", () => {
		expect(parseCookies("admin_session=abc; csrf=xyz")).toEqual({
			admin_session: "abc",
			csrf: "xyz",
		});
	});

	it("serializes secure HttpOnly cookies", () => {
		const cookie = serializeCookie("admin_session", "abc", {
			httpOnly: true,
			maxAge: 60,
			path: "/",
			sameSite: "Lax",
			secure: true,
		});
		expect(cookie).toContain("admin_session=abc");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Max-Age=60");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Secure");
	});
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- tests/http.test.ts tests/crypto.test.ts tests/cookies.test.ts
```

Expected: FAIL because the utility modules do not exist.

- [ ] **Step 3: Implement utilities**

Create `workers/http.ts`:

```ts
import type { ApiErrorBody, ApiErrorCode } from "./types";

export function json<T>(body: T, status = 200, headers = new Headers()): Response {
	headers.set("content-type", "application/json; charset=utf-8");
	return new Response(JSON.stringify(body), { status, headers });
}

export function errorJson(
	code: ApiErrorCode,
	message: string,
	status: number,
): Response {
	return json<ApiErrorBody>({ error: { code, message } }, status);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("Expected JSON object body");
	}
	return body as Record<string, unknown>;
}
```

Create `workers/crypto.ts`:

```ts
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
	const data = typeof input === "string" ? textEncoder.encode(input) : input;
	const digest = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function randomToken(bytes = 32): string {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	return [...buffer].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashPassword(password: string, salt = randomToken(16)): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		textEncoder.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt: textEncoder.encode(salt),
			iterations: 210_000,
		},
		key,
		256,
	);
	return `pbkdf2-sha256:210000:${salt}:${await sha256Hex(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const [algorithm, iterations, salt, expected] = stored.split(":");
	if (algorithm !== "pbkdf2-sha256" || iterations !== "210000" || !salt || !expected) {
		return false;
	}
	const actual = await hashPassword(password, salt);
	return actual === stored;
}

async function encryptionKey(rootKey: string): Promise<CryptoKey> {
	const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(rootKey));
	return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
		"encrypt",
		"decrypt",
	]);
}

export async function encryptString(plainText: string, rootKey: string): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await encryptionKey(rootKey),
		textEncoder.encode(plainText),
	);
	return `${btoa(String.fromCharCode(...iv))}.${btoa(
		String.fromCharCode(...new Uint8Array(encrypted)),
	)}`;
}

export async function decryptString(cipherText: string, rootKey: string): Promise<string> {
	const [ivBase64, dataBase64] = cipherText.split(".");
	if (!ivBase64 || !dataBase64) {
		throw new Error("Invalid encrypted value");
	}
	const iv = Uint8Array.from(atob(ivBase64), (char) => char.charCodeAt(0));
	const data = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
	const decrypted = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		await encryptionKey(rootKey),
		data,
	);
	return textDecoder.decode(decrypted);
}
```

Create `workers/cookies.ts`:

```ts
interface CookieOptions {
	httpOnly?: boolean;
	maxAge?: number;
	path?: string;
	sameSite?: "Lax" | "Strict" | "None";
	secure?: boolean;
}

export function parseCookies(header: string | null): Record<string, string> {
	if (!header) return {};
	return Object.fromEntries(
		header.split(";").map((part) => {
			const [name, ...valueParts] = part.trim().split("=");
			return [name, decodeURIComponent(valueParts.join("="))];
		}),
	);
}

export function serializeCookie(
	name: string,
	value: string,
	options: CookieOptions,
): string {
	const parts = [`${name}=${encodeURIComponent(value)}`];
	if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
	if (options.path) parts.push(`Path=${options.path}`);
	if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
	if (options.httpOnly) parts.push("HttpOnly");
	if (options.secure) parts.push("Secure");
	return parts.join("; ");
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npm test -- tests/http.test.ts tests/crypto.test.ts tests/cookies.test.ts
```

Expected: all utility tests pass.

- [ ] **Step 5: Commit**

```bash
git add workers/http.ts workers/crypto.ts workers/cookies.ts tests/http.test.ts tests/crypto.test.ts tests/cookies.test.ts
git commit -m "feat: add worker utility primitives"
```

## Task 4: Settings, Password Bootstrap, and Repositories

**Files:**
- Create: `workers/db/d1.ts`
- Create: `workers/settings.ts`
- Create: `workers/auth.ts`
- Create: `tests/settings.test.ts`
- Create: `tests/auth.test.ts`

- [ ] **Step 1: Write settings and auth tests**

Create `tests/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decryptString } from "../workers/crypto";
import { redactSettings, serializeSettingsForStorage } from "../workers/settings";

describe("settings storage helpers", () => {
	it("encrypts sensitive settings before persistence", async () => {
		const rows = await serializeSettingsForStorage(
			{
				siteTitle: "233 Life",
				notionDatabaseUrl: "https://www.notion.so/renke-me/c5e926f6cd3c4671bb0b86737143570b",
				notionDatabaseId: "c5e926f6cd3c4671bb0b86737143570b",
				notionToken: "ntn_secret",
				cdnBaseUrl: "https://cdn.example.com",
				fieldMapping: { title: "Name", status: "Status" },
			},
			"root-key",
		);
		const tokenRow = rows.find((row) => row.key === "notionToken");
		expect(tokenRow?.encrypted).toBe(1);
		expect(tokenRow?.value).not.toBe("ntn_secret");
		expect(await decryptString(tokenRow!.value, "root-key")).toBe("ntn_secret");
	});

	it("redacts sensitive values for admin reads", () => {
		expect(
			redactSettings({
				siteTitle: "233 Life",
				notionDatabaseUrl: "url",
				notionDatabaseId: "id",
				notionToken: "ntn_secret",
				cdnBaseUrl: "https://cdn.example.com",
				fieldMapping: { title: "Name", status: "Status" },
			}),
		).toMatchObject({ notionToken: "" });
	});
});
```

Create `tests/auth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSessionToken, verifySessionToken } from "../workers/auth";

describe("auth session tokens", () => {
	it("creates and verifies signed session tokens", async () => {
		const token = await createSessionToken("root-key", "csrf-token");
		const session = await verifySessionToken(token, "root-key");
		expect(session.csrfToken).toBe("csrf-token");
		expect(session.expiresAt).toBeGreaterThan(Date.now());
	});

	it("rejects tokens signed with a different key", async () => {
		const token = await createSessionToken("root-key", "csrf-token");
		await expect(verifySessionToken(token, "other-key")).rejects.toThrow(
			"Invalid session",
		);
	});
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- tests/settings.test.ts tests/auth.test.ts
```

Expected: FAIL because settings and auth modules do not exist.

- [ ] **Step 3: Implement settings helpers**

Create `workers/settings.ts` with:

```ts
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
	const entries = Object.entries(settings) as [keyof SiteSettings, SiteSettings[keyof SiteSettings]][];
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
```

- [ ] **Step 4: Implement auth tokens**

Create `workers/auth.ts` with:

```ts
import { randomToken, sha256Hex } from "./crypto";

export interface AdminSession {
	csrfToken: string;
	expiresAt: number;
}

const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;

async function signature(payload: string, rootKey: string): Promise<string> {
	return sha256Hex(`${payload}.${rootKey}`);
}

export async function createSessionToken(
	rootKey: string,
	csrfToken = randomToken(24),
	now = Date.now(),
): Promise<string> {
	const payload = btoa(
		JSON.stringify({ csrfToken, expiresAt: now + sessionTtlMs } satisfies AdminSession),
	);
	return `${payload}.${await signature(payload, rootKey)}`;
}

export async function verifySessionToken(
	token: string,
	rootKey: string,
	now = Date.now(),
): Promise<AdminSession> {
	const [payload, signed] = token.split(".");
	if (!payload || !signed || (await signature(payload, rootKey)) !== signed) {
		throw new Error("Invalid session");
	}
	const session = JSON.parse(atob(payload)) as AdminSession;
	if (session.expiresAt <= now) {
		throw new Error("Invalid session");
	}
	return session;
}
```

- [ ] **Step 5: Add D1 repository skeleton**

Create `workers/db/d1.ts`:

```ts
import type { SettingRow } from "../settings";

export class SettingsRepository {
	constructor(private readonly db: D1Database) {}

	async get(key: string): Promise<SettingRow | null> {
		return this.db
			.prepare("SELECT key, value, encrypted, updated_at FROM settings WHERE key = ?")
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
```

- [ ] **Step 6: Verify GREEN**

Run:

```bash
npm test -- tests/settings.test.ts tests/auth.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 7: Commit**

```bash
git add workers/db/d1.ts workers/settings.ts workers/auth.ts tests/settings.test.ts tests/auth.test.ts
git commit -m "feat: add settings and auth foundations"
```

## Task 5: Notion Schema Mapping

**Files:**
- Modify: `workers/notion/database.ts`
- Create: `workers/notion/client.ts`
- Create: `tests/notion-mapping.test.ts`

- [ ] **Step 1: Write failing field mapping tests**

Create `tests/notion-mapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { inferFieldMapping, isPublishedStatus } from "../workers/notion/database";

describe("inferFieldMapping", () => {
	it("maps common Notion property names to blog fields", () => {
		const mapping = inferFieldMapping({
			Name: { type: "title" },
			Status: { type: "status" },
			Slug: { type: "rich_text" },
			Summary: { type: "rich_text" },
			Tags: { type: "multi_select" },
			Date: { type: "date" },
		});
		expect(mapping).toEqual({
			title: "Name",
			status: "Status",
			slug: "Slug",
			summary: "Summary",
			tags: "Tags",
			publishedAt: "Date",
		});
	});
});

describe("isPublishedStatus", () => {
	it("accepts English and Chinese published statuses", () => {
		expect(isPublishedStatus("Published")).toBe(true);
		expect(isPublishedStatus("已发布")).toBe(true);
		expect(isPublishedStatus("Draft")).toBe(false);
	});
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test -- tests/notion-mapping.test.ts
```

Expected: FAIL because `inferFieldMapping` and `isPublishedStatus` are missing.

- [ ] **Step 3: Implement mapping logic**

Append to `workers/notion/database.ts`:

```ts
import type { FieldMapping } from "../types";

export interface NotionPropertySchema {
	type: string;
}

export type NotionPropertiesSchema = Record<string, NotionPropertySchema>;

function findByNames(
	properties: NotionPropertiesSchema,
	names: string[],
	types?: string[],
): string | undefined {
	const normalized = new Map(
		Object.keys(properties).map((name) => [name.toLowerCase().replaceAll(" ", ""), name]),
	);
	for (const name of names) {
		const actual = normalized.get(name.toLowerCase().replaceAll(" ", ""));
		if (actual && (!types || types.includes(properties[actual].type))) return actual;
	}
	return undefined;
}

export function inferFieldMapping(properties: NotionPropertiesSchema): FieldMapping {
	const title =
		Object.entries(properties).find(([, value]) => value.type === "title")?.[0] ??
		findByNames(properties, ["title", "name", "标题"]);
	const status = findByNames(properties, ["status", "publish", "published", "状态"], [
		"status",
		"select",
		"checkbox",
	]);
	if (!title || !status) {
		throw new Error("FIELD_MAPPING_INVALID");
	}
	return {
		title,
		status,
		slug: findByNames(properties, ["slug", "url", "name"]),
		summary: findByNames(properties, ["summary", "description", "excerpt", "摘要"]),
		tags: findByNames(properties, ["tags", "tag", "标签"], ["multi_select", "select"]),
		publishedAt: findByNames(properties, ["date", "published_at", "published", "发布日期"], [
			"date",
			"created_time",
		]),
		cover: findByNames(properties, ["cover", "封面"], ["files", "url"]),
	};
}

export function isPublishedStatus(value: unknown): boolean {
	return value === "Published" || value === "已发布" || value === true;
}
```

- [ ] **Step 4: Implement Notion client**

Create `workers/notion/client.ts`:

```ts
export class NotionApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
	}
}

export class NotionClient {
	constructor(
		private readonly token: string,
		private readonly fetcher: typeof fetch = fetch,
	) {}

	async request<T>(path: string, init: RequestInit = {}): Promise<T> {
		const response = await this.fetcher(`https://api.notion.com/v1${path}`, {
			...init,
			headers: {
				"authorization": `Bearer ${this.token}`,
				"notion-version": "2022-06-28",
				"content-type": "application/json",
				...init.headers,
			},
		});
		if (!response.ok) {
			throw new NotionApiError(await response.text(), response.status);
		}
		return response.json<T>();
	}

	database(databaseId: string): Promise<{ properties: Record<string, { type: string }> }> {
		return this.request(`/databases/${databaseId}`);
	}
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/notion-database.test.ts tests/notion-mapping.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add workers/notion/database.ts workers/notion/client.ts tests/notion-mapping.test.ts
git commit -m "feat: infer notion field mappings"
```

## Task 6: Block-to-Markdown and Asset Processing

**Files:**
- Create: `workers/notion/blocks.ts`
- Create: `workers/assets.ts`
- Create: `tests/notion-blocks.test.ts`
- Create: `tests/assets.test.ts`

- [ ] **Step 1: Write failing block and asset tests**

Create `tests/notion-blocks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blocksToMarkdown, normalizedBlocksHash } from "../workers/notion/blocks";

describe("blocksToMarkdown", () => {
	it("converts headings, paragraphs, lists, code, and images", async () => {
		const markdown = await blocksToMarkdown([
			{ type: "heading_1", heading_1: { rich_text: [{ plain_text: "Hello" }] } },
			{ type: "paragraph", paragraph: { rich_text: [{ plain_text: "World" }] } },
			{ type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "One" }] } },
			{ type: "code", code: { language: "ts", rich_text: [{ plain_text: "const x = 1;" }] } },
			{ type: "image", image: { type: "external", external: { url: "https://example.com/a.png" } } },
		]);
		expect(markdown).toContain("# Hello");
		expect(markdown).toContain("World");
		expect(markdown).toContain("- One");
		expect(markdown).toContain("```ts");
		expect(markdown).toContain("![image](https://example.com/a.png)");
	});

	it("hashes normalized block content deterministically", async () => {
		const blocks = [{ id: "1", type: "paragraph", paragraph: { rich_text: [{ plain_text: "A" }] } }];
		await expect(normalizedBlocksHash(blocks)).resolves.toMatch(/^[a-f0-9]{64}$/);
	});
});
```

Create `tests/assets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAssetKey, cdnUrlForKey } from "../workers/assets";

describe("asset helpers", () => {
	it("builds content-addressed R2 keys", () => {
		expect(buildAssetKey("abc123", "image/png")).toBe("assets/ab/abc123.png");
	});

	it("builds CDN URLs without duplicate slashes", () => {
		expect(cdnUrlForKey("https://cdn.example.com/", "assets/ab/file.png")).toBe(
			"https://cdn.example.com/assets/ab/file.png",
		);
	});
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- tests/notion-blocks.test.ts tests/assets.test.ts
```

Expected: FAIL because block and asset modules do not exist.

- [ ] **Step 3: Implement Markdown conversion**

Create `workers/notion/blocks.ts`:

```ts
import { sha256Hex } from "../crypto";

type RichText = { plain_text?: string };
type NotionBlock = Record<string, unknown> & { type: string };

function richText(blockValue: unknown): string {
	const value = blockValue as { rich_text?: RichText[] };
	return value.rich_text?.map((part) => part.plain_text ?? "").join("") ?? "";
}

function fileUrl(file: unknown): string | null {
	const value = file as {
		type?: "external" | "file";
		external?: { url?: string };
		file?: { url?: string };
	};
	return value.external?.url ?? value.file?.url ?? null;
}

export async function blocksToMarkdown(blocks: NotionBlock[]): Promise<string> {
	const lines: string[] = [];
	for (const block of blocks) {
		const value = block[block.type];
		switch (block.type) {
			case "heading_1":
				lines.push(`# ${richText(value)}`);
				break;
			case "heading_2":
				lines.push(`## ${richText(value)}`);
				break;
			case "heading_3":
				lines.push(`### ${richText(value)}`);
				break;
			case "paragraph":
				lines.push(richText(value));
				break;
			case "bulleted_list_item":
				lines.push(`- ${richText(value)}`);
				break;
			case "numbered_list_item":
				lines.push(`1. ${richText(value)}`);
				break;
			case "quote":
				lines.push(`> ${richText(value)}`);
				break;
			case "divider":
				lines.push("---");
				break;
			case "code": {
				const code = value as { language?: string; rich_text?: RichText[] };
				lines.push(`\`\`\`${code.language ?? ""}\n${richText(code)}\n\`\`\``);
				break;
			}
			case "image": {
				const url = fileUrl(value);
				if (url) lines.push(`![image](${url})`);
				break;
			}
			case "file": {
				const url = fileUrl(value);
				if (url) lines.push(`[file](${url})`);
				break;
			}
			default:
				break;
		}
	}
	return `${lines.filter(Boolean).join("\n\n")}\n`;
}

export async function normalizedBlocksHash(blocks: unknown[]): Promise<string> {
	return sha256Hex(JSON.stringify(blocks));
}
```

- [ ] **Step 4: Implement asset helpers**

Create `workers/assets.ts`:

```ts
const extensions: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
	"application/pdf": "pdf",
};

export function buildAssetKey(contentHash: string, mimeType: string | null): string {
	const extension = mimeType ? extensions[mimeType] : undefined;
	const suffix = extension ? `.${extension}` : "";
	return `assets/${contentHash.slice(0, 2)}/${contentHash}${suffix}`;
}

export function cdnUrlForKey(cdnBaseUrl: string, key: string): string {
	return `${cdnBaseUrl.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/notion-blocks.test.ts tests/assets.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add workers/notion/blocks.ts workers/assets.ts tests/notion-blocks.test.ts tests/assets.test.ts
git commit -m "feat: convert notion blocks and address assets"
```

## Task 7: Public API Repositories and Endpoints

**Files:**
- Modify: `workers/db/d1.ts`
- Create: `workers/api/public.ts`
- Create: `tests/public-api.test.ts`

- [ ] **Step 1: Write failing public API tests**

Create `tests/public-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listPostsResponse, postDetailResponse } from "../workers/api/public";

const posts = [
	{
		id: "post_1",
		slug: "hello",
		title: "Hello",
		summary: "Intro",
		coverUrl: null,
		tags: ["Life"],
		status: "Published",
		visibility: "published",
		publishedAt: "2026-05-18T00:00:00.000Z",
		notionLastEditedTime: "2026-05-18T01:00:00.000Z",
		contentHash: "abc",
	},
	{
		id: "post_2",
		slug: "draft",
		title: "Draft",
		summary: null,
		coverUrl: null,
		tags: [],
		status: "Draft",
		visibility: "hidden",
		publishedAt: null,
		notionLastEditedTime: "2026-05-18T01:00:00.000Z",
		contentHash: "def",
	},
];

describe("public API responders", () => {
	it("lists only published posts", () => {
		expect(listPostsResponse(posts).items.map((post) => post.slug)).toEqual(["hello"]);
	});

	it("returns detail with markdown for a published post", () => {
		expect(postDetailResponse(posts[0], "# Hello\n")).toMatchObject({
			slug: "hello",
			markdown: "# Hello\n",
		});
	});
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test -- tests/public-api.test.ts
```

Expected: FAIL because public API module does not exist.

- [ ] **Step 3: Implement public API pure responders**

Create `workers/api/public.ts`:

```ts
import { PostsRepository, PostContentRepository } from "../db/d1";
import { errorJson, json } from "../http";
import type { AppEnv } from "../types";

export interface PublicPostRecord {
	id: string;
	slug: string;
	title: string;
	summary: string | null;
	coverUrl: string | null;
	tags: string[];
	status: string;
	visibility: "published" | "hidden" | "archived";
	publishedAt: string | null;
	notionLastEditedTime: string;
	contentHash: string | null;
}

export function listPostsResponse(posts: PublicPostRecord[]) {
	const items = posts.filter((post) => post.visibility === "published");
	return { items, total: items.length };
}

export function postDetailResponse(post: PublicPostRecord, markdown: string) {
	return { ...post, markdown };
}

export async function handlePublicApi(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/api/health") return json({ ok: true });
	const posts = new PostsRepository(env.DB);
	const content = new PostContentRepository(env.DB);
	if (url.pathname === "/api/posts" && request.method === "GET") {
		const limit = Number(url.searchParams.get("limit") ?? "20");
		const page = Number(url.searchParams.get("page") ?? "1");
		return json(listPostsResponse(await posts.listPublished(limit, (page - 1) * limit)));
	}
	if (url.pathname.startsWith("/api/posts/") && request.method === "GET") {
		const slug = decodeURIComponent(url.pathname.replace("/api/posts/", ""));
		const post = await posts.findPublishedBySlug(slug);
		if (!post) return errorJson("NOT_FOUND", "Post not found", 404);
		return json(postDetailResponse(post, await content.markdownForPost(post.id)));
	}
	if (url.pathname === "/api/tags" && request.method === "GET") {
		return json({ items: await posts.listTags() });
	}
	if (url.pathname === "/api/search" && request.method === "GET") {
		return json({ items: await posts.searchPublished(url.searchParams.get("q") ?? "") });
	}
	return errorJson("NOT_FOUND", "API route not found", 404);
}
```

- [ ] **Step 4: Add D1 post repository methods**

Extend `workers/db/d1.ts` with repository methods:

```ts
import type { PublicPostRecord } from "../api/public";

export class PostsRepository {
	constructor(private readonly db: D1Database) {}

	async listPublished(limit: number, offset: number): Promise<PublicPostRecord[]> {
		const result = await this.db
			.prepare(
				`SELECT id, slug, title, summary, cover_url, tags_json, status, visibility,
				        published_at, notion_last_edited_time, content_hash
				 FROM posts
				 WHERE visibility = 'published'
				 ORDER BY published_at DESC
				 LIMIT ? OFFSET ?`,
			)
			.bind(limit, offset)
			.all<Record<string, unknown>>();
		return result.results.map(rowToPublicPost);
	}

	async findPublishedBySlug(slug: string): Promise<PublicPostRecord | null> {
		const row = await this.db
			.prepare(
				`SELECT id, slug, title, summary, cover_url, tags_json, status, visibility,
				        published_at, notion_last_edited_time, content_hash
				 FROM posts
				 WHERE slug = ? AND visibility = 'published'`,
			)
			.bind(slug)
			.first<Record<string, unknown>>();
		return row ? rowToPublicPost(row) : null;
	}

	async listTags(): Promise<Array<{ tag: string; count: number }>> {
		const posts = await this.listPublished(500, 0);
		const counts = new Map<string, number>();
		for (const post of posts) {
			for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
		return [...counts.entries()]
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => a.tag.localeCompare(b.tag));
	}

	async searchPublished(query: string): Promise<PublicPostRecord[]> {
		const like = `%${query}%`;
		const result = await this.db
			.prepare(
				`SELECT DISTINCT p.id, p.slug, p.title, p.summary, p.cover_url, p.tags_json,
				        p.status, p.visibility, p.published_at, p.notion_last_edited_time,
				        p.content_hash
				 FROM posts p
				 LEFT JOIN post_content c ON c.post_id = p.id
				 WHERE p.visibility = 'published'
				   AND (? = '' OR p.title LIKE ? OR p.summary LIKE ? OR c.markdown LIKE ?)
				 ORDER BY p.published_at DESC
				 LIMIT 50`,
			)
			.bind(query, like, like, like)
			.all<Record<string, unknown>>();
		return result.results.map(rowToPublicPost);
	}
}

export class PostContentRepository {
	constructor(private readonly db: D1Database) {}

	async markdownForPost(postId: string): Promise<string> {
		const row = await this.db
			.prepare("SELECT markdown FROM post_content WHERE post_id = ?")
			.bind(postId)
			.first<{ markdown: string }>();
		return row?.markdown ?? "";
	}
}

function rowToPublicPost(row: Record<string, unknown>): PublicPostRecord {
	return {
		id: String(row.id),
		slug: String(row.slug),
		title: String(row.title),
		summary: row.summary ? String(row.summary) : null,
		coverUrl: row.cover_url ? String(row.cover_url) : null,
		tags: JSON.parse(String(row.tags_json ?? "[]")) as string[],
		status: String(row.status),
		visibility: row.visibility as PublicPostRecord["visibility"],
		publishedAt: row.published_at ? String(row.published_at) : null,
		notionLastEditedTime: String(row.notion_last_edited_time),
		contentHash: row.content_hash ? String(row.content_hash) : null,
	};
}
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/public-api.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add workers/db/d1.ts workers/api/public.ts tests/public-api.test.ts
git commit -m "feat: add public blog api responders"
```

## Task 8: Admin API and Worker Routing

**Files:**
- Modify: `workers/app.ts`
- Create: `workers/api/admin.ts`
- Create: `tests/admin-api.test.ts`
- Create: `tests/worker-routing.test.ts`

- [ ] **Step 1: Write failing routing tests**

Create `tests/admin-api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateLoginBody } from "../workers/api/admin";

describe("admin API validation", () => {
	it("accepts password login bodies", () => {
		expect(validateLoginBody({ password: "123456" })).toEqual({ password: "123456" });
	});

	it("rejects missing passwords", () => {
		expect(() => validateLoginBody({})).toThrow("Password is required");
	});
});
```

Create `tests/worker-routing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { routeKind } from "../workers/app";

describe("Worker routing", () => {
	it("routes api paths to API handlers", () => {
		expect(routeKind(new Request("https://example.com/api/posts"))).toBe("api");
	});

	it("routes other paths to the app shell", () => {
		expect(routeKind(new Request("https://example.com/post/hello"))).toBe("app");
	});
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- tests/admin-api.test.ts tests/worker-routing.test.ts
```

Expected: FAIL because admin API and routing helpers are missing.

- [ ] **Step 3: Implement admin validation**

Create `workers/api/admin.ts`:

```ts
import { errorJson, json, readJsonObject } from "../http";
import type { AppEnv } from "../types";

export function validateLoginBody(body: Record<string, unknown>): { password: string } {
	if (typeof body.password !== "string" || body.password.length === 0) {
		throw new Error("Password is required");
	}
	return { password: body.password };
}

export async function handleAdminApi(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname === "/api/admin/login" && request.method === "POST") {
		const body = validateLoginBody(await readJsonObject(request));
		return json({ ok: true, passwordLength: body.password.length });
	}
	if (url.pathname === "/api/admin/me" && request.method === "GET") {
		return json({ authenticated: false });
	}
	return errorJson("NOT_FOUND", "Admin API route not found", 404);
}
```

This intentionally returns a temporary login body. Task 9 replaces it with real password/session behavior after the session flow tests are in place.

- [ ] **Step 4: Route API paths in Worker**

Modify `workers/app.ts`:

```ts
import { handleAdminApi } from "./api/admin";
import { handlePublicApi } from "./api/public";
import { errorJson } from "./http";
import type { AppEnv } from "./types";

export function routeKind(request: Request): "api" | "app" {
	return new URL(request.url).pathname.startsWith("/api/") ? "api" : "app";
}

async function handleApi(request: Request, env: AppEnv): Promise<Response> {
	const url = new URL(request.url);
	if (url.pathname.startsWith("/api/admin/")) return handleAdminApi(request, env);
	if (url.pathname.startsWith("/api/")) return handlePublicApi(request, env);
	return errorJson("NOT_FOUND", "API route not found", 404);
}

async function handleAppShell(request: Request, env: AppEnv): Promise<Response> {
	const assetResponse = await env.ASSETS.fetch(request);
	if (assetResponse.status !== 404) return assetResponse;
	const url = new URL(request.url);
	url.pathname = "/";
	url.search = "";
	return env.ASSETS.fetch(new Request(url, request));
}

export default {
	fetch(request, env) {
		if (routeKind(request) === "api") return handleApi(request, env);
		return handleAppShell(request, env);
	},
	scheduled(_controller, env, ctx) {
		ctx.waitUntil(Promise.resolve(env));
	},
} satisfies ExportedHandler<AppEnv>;
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/admin-api.test.ts tests/worker-routing.test.ts
npm run build
```

Expected: tests pass and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add workers/app.ts workers/api/admin.ts tests/admin-api.test.ts tests/worker-routing.test.ts
git commit -m "feat: route worker api requests"
```

## Task 9: Real Admin Authentication and Settings APIs

**Files:**
- Modify: `workers/api/admin.ts`
- Modify: `workers/auth.ts`
- Modify: `workers/cookies.ts`
- Modify: `workers/settings.ts`
- Modify: `workers/db/d1.ts`
- Create: `tests/admin-auth-flow.test.ts`

- [ ] **Step 1: Write failing auth flow tests**

Create `tests/admin-auth-flow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldBootstrapPassword } from "../workers/auth";

describe("admin password bootstrap", () => {
	it("uses the initial password only when no stored hash exists", () => {
		expect(shouldBootstrapPassword(null)).toBe(true);
		expect(shouldBootstrapPassword("pbkdf2-sha256:210000:salt:hash")).toBe(false);
	});
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test -- tests/admin-auth-flow.test.ts
```

Expected: FAIL because `shouldBootstrapPassword` is missing.

- [ ] **Step 3: Implement password bootstrap helper**

Append to `workers/auth.ts`:

```ts
export const initialAdminPassword = "123456";

export function shouldBootstrapPassword(storedHash: string | null): boolean {
	return storedHash === null;
}
```

- [ ] **Step 4: Replace temporary admin API behavior**

Update `workers/api/admin.ts` so:

- `POST /api/admin/login` reads `adminPasswordHash` from `settings`;
- if no hash exists, verifies against `initialAdminPassword`;
- on success, creates a session token and a CSRF token;
- sets `admin_session` as `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`;
- returns `{ "authenticated": true, "csrfToken": "<token>" }`;
- `POST /api/admin/logout` clears `admin_session`;
- `GET /api/admin/me` verifies the session cookie;
- `GET /api/admin/settings` returns redacted settings;
- `PUT /api/admin/settings` requires a valid session and CSRF token, then stores encrypted settings rows.

Use the existing helpers:

```ts
const cookie = request.headers.get("cookie");
const sessionToken = parseCookies(cookie).admin_session;
```

CSRF validation rule:

```ts
const csrfHeader = request.headers.get("x-csrf-token");
if (csrfHeader !== session.csrfToken) return errorJson("FORBIDDEN", "Invalid CSRF token", 403);
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/admin-auth-flow.test.ts tests/admin-api.test.ts tests/settings.test.ts tests/auth.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit**

```bash
git add workers/api/admin.ts workers/auth.ts workers/cookies.ts workers/settings.ts workers/db/d1.ts tests/admin-auth-flow.test.ts
git commit -m "feat: add admin auth and settings api"
```

## Task 10: Sync Service, Notion Page Mapping, and Cron

**Files:**
- Modify: `workers/sync.ts`
- Modify: `workers/app.ts`
- Modify: `workers/notion/client.ts`
- Modify: `workers/notion/database.ts`
- Modify: `workers/db/d1.ts`
- Create: `tests/sync.test.ts`

- [ ] **Step 1: Write failing sync tests**

Create `tests/sync.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { planSyncWindow, syncVisibilityForStatus } from "../workers/sync";

describe("sync planning", () => {
	it("uses the requested manual range when present", () => {
		expect(
			planSyncWindow({
				lastSuccessfulSync: "2026-05-17T00:00:00.000Z",
				rangeStart: "2026-05-01T00:00:00.000Z",
				rangeEnd: "2026-05-18T00:00:00.000Z",
			}),
		).toEqual({
			start: "2026-05-01T00:00:00.000Z",
			end: "2026-05-18T00:00:00.000Z",
		});
	});

	it("falls back to last successful sync for nightly runs", () => {
		expect(planSyncWindow({ lastSuccessfulSync: "2026-05-17T00:00:00.000Z" })).toEqual({
			start: "2026-05-17T00:00:00.000Z",
			end: null,
		});
	});
});

describe("syncVisibilityForStatus", () => {
	it("publishes only accepted statuses", () => {
		expect(syncVisibilityForStatus("Published")).toBe("published");
		expect(syncVisibilityForStatus("已发布")).toBe("published");
		expect(syncVisibilityForStatus("Draft")).toBe("hidden");
	});
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test -- tests/sync.test.ts
```

Expected: FAIL because `workers/sync.ts` does not exist.

- [ ] **Step 3: Implement sync planning functions**

Create `workers/sync.ts`:

```ts
import { isPublishedStatus } from "./notion/database";

export interface SyncWindowInput {
	lastSuccessfulSync: string | null;
	rangeStart?: string | null;
	rangeEnd?: string | null;
}

export function planSyncWindow(input: SyncWindowInput): { start: string | null; end: string | null } {
	return {
		start: input.rangeStart ?? input.lastSuccessfulSync,
		end: input.rangeEnd ?? null,
	};
}

export function syncVisibilityForStatus(status: unknown): "published" | "hidden" {
	return isPublishedStatus(status) ? "published" : "hidden";
}
```

- [ ] **Step 4: Add full sync orchestration**

Extend `workers/sync.ts` with:

```ts
import type { AppEnv } from "./types";

export interface RunSyncInput {
	triggerType: "cron" | "manual";
	rangeStart?: string | null;
	rangeEnd?: string | null;
	force?: boolean;
}

export async function runSync(env: AppEnv, input: RunSyncInput): Promise<{ runId: string }> {
	const runId = crypto.randomUUID();
	const startedAt = new Date().toISOString();
	await env.DB.prepare(
		`INSERT INTO sync_runs (id, trigger_type, started_at, status, range_start, range_end, force)
		 VALUES (?, ?, ?, 'running', ?, ?, ?)`,
	)
		.bind(runId, input.triggerType, startedAt, input.rangeStart ?? null, input.rangeEnd ?? null, input.force ? 1 : 0)
		.run();

	await env.DB.prepare(
		`UPDATE sync_runs
		 SET finished_at = ?, status = 'success'
		 WHERE id = ?`,
	)
		.bind(new Date().toISOString(), runId)
		.run();

	return { runId };
}
```

This is the first green slice. In the same task, add Notion query/page/block processing behind private helper functions after adding tests for those helpers. Keep each helper pure where possible:

- map Notion page properties to local post metadata;
- call `blocksToMarkdown`;
- replace asset URLs after R2 upload;
- upsert `posts` and `post_content`;
- insert `sync_items`.

- [ ] **Step 5: Wire Cron**

Modify `workers/app.ts` scheduled handler:

```ts
import { runSync } from "./sync";

// inside default export
scheduled(_controller, env, ctx) {
	ctx.waitUntil(runSync(env, { triggerType: "cron", force: false }));
},
```

- [ ] **Step 6: Add manual sync API**

Update `workers/api/admin.ts`:

- `POST /api/admin/sync` validates session and CSRF;
- accepts body `{ "rangeStart": string | null, "rangeEnd": string | null, "force": boolean }`;
- calls `runSync(env, { triggerType: "manual", rangeStart, rangeEnd, force })`;
- returns `{ "runId": "<id>" }`.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
npm test -- tests/sync.test.ts
npm run typecheck
npm run build
```

Expected: tests, typecheck, and build pass.

- [ ] **Step 8: Commit**

```bash
git add workers/sync.ts workers/app.ts workers/notion/client.ts workers/notion/database.ts workers/db/d1.ts workers/api/admin.ts tests/sync.test.ts
git commit -m "feat: add notion sync orchestration"
```

## Task 11: Public Blog UI

**Files:**
- Modify: `app/routes/home.tsx`
- Create: `app/routes/post.tsx`
- Create: `app/routes/tag.tsx`
- Create: `app/routes/search.tsx`
- Create: `app/components/public/PostList.tsx`
- Create: `app/components/public/PostDetail.tsx`
- Create: `app/lib/api-client.ts`
- Create: `app/lib/markdown.tsx`
- Modify: `app/app.css`
- Create: `tests/api-client.test.ts`

- [ ] **Step 1: Write failing API client test**

Create `tests/api-client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { apiGet } from "../app/lib/api-client";

describe("apiGet", () => {
	it("fetches JSON API responses", async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
			}),
		);
		await expect(apiGet("/api/health", fetcher)).resolves.toEqual({ ok: true });
		expect(fetcher).toHaveBeenCalledWith("/api/health", { credentials: "same-origin" });
	});
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test -- tests/api-client.test.ts
```

Expected: FAIL because `app/lib/api-client.ts` does not exist.

- [ ] **Step 3: Implement API client**

Create `app/lib/api-client.ts`:

```ts
export async function apiGet<T>(
	path: string,
	fetcher: typeof fetch = fetch,
): Promise<T> {
	const response = await fetcher(path, { credentials: "same-origin" });
	if (!response.ok) {
		throw new Error(`API request failed: ${response.status}`);
	}
	return response.json<T>();
}

export async function apiPost<T>(
	path: string,
	body: unknown,
	csrfToken?: string,
	fetcher: typeof fetch = fetch,
): Promise<T> {
	const response = await fetcher(path, {
		method: "POST",
		credentials: "same-origin",
		headers: {
			"content-type": "application/json",
			...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
		},
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		throw new Error(`API request failed: ${response.status}`);
	}
	return response.json<T>();
}
```

- [ ] **Step 4: Build public components**

Implement `PostList.tsx` and public route files using `useEffect` and `apiGet`. Route behavior:

- `/` calls `/api/posts`;
- `/post/:slug` calls `/api/posts/:slug`;
- `/tags/:tag` calls `/api/posts?tag=<tag>`;
- `/search?q=<keyword>` calls `/api/search?q=<keyword>`.

Use loading, error, empty, and success states. Do not export loaders or actions from route files.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/api-client.test.ts
npm run build
```

Expected: API client test passes and SPA build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/routes/home.tsx app/routes/post.tsx app/routes/tag.tsx app/routes/search.tsx app/components/public app/lib/api-client.ts app/lib/markdown.tsx app/app.css tests/api-client.test.ts
git commit -m "feat: add public blog ui"
```

## Task 12: Admin Console UI

**Files:**
- Modify: `app/routes/admin.tsx`
- Create: `app/components/admin/AdminLogin.tsx`
- Create: `app/components/admin/AdminShell.tsx`
- Create: `app/components/admin/SettingsPanel.tsx`
- Create: `app/components/admin/SyncPanel.tsx`
- Create: `app/components/admin/PostStatusTable.tsx`
- Create: `tests/admin-ui.test.tsx`

- [ ] **Step 1: Write failing admin login component test**

Create `tests/admin-ui.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminLogin } from "../app/components/admin/AdminLogin";

describe("AdminLogin", () => {
	it("renders password login form", () => {
		render(<AdminLogin onLogin={vi.fn()} />);
		expect(screen.getByLabelText("Password")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
	});
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
npm test -- tests/admin-ui.test.tsx
```

Expected: FAIL because admin components do not exist.

- [ ] **Step 3: Implement admin login component**

Create `app/components/admin/AdminLogin.tsx`:

```tsx
import { useState } from "react";

export function AdminLogin({ onLogin }: { onLogin: (password: string) => Promise<void> | void }) {
	const [password, setPassword] = useState("");

	return (
		<form
			className="mx-auto flex max-w-sm flex-col gap-4 rounded border border-slate-200 p-6"
			onSubmit={(event) => {
				event.preventDefault();
				void onLogin(password);
			}}
		>
			<label className="flex flex-col gap-2 text-sm font-medium">
				Password
				<input
					className="rounded border border-slate-300 px-3 py-2"
					type="password"
					value={password}
					onChange={(event) => setPassword(event.target.value)}
				/>
			</label>
			<button className="rounded bg-slate-950 px-4 py-2 text-white" type="submit">
				Log in
			</button>
		</form>
	);
}
```

- [ ] **Step 4: Implement admin route and panels**

Implement `app/routes/admin.tsx` with client state:

- call `/api/admin/me` on mount;
- show `AdminLogin` when unauthenticated;
- after login, store CSRF token in component state;
- show `AdminShell` with overview, settings, sync, and posts tabs;
- settings panel calls `GET/PUT /api/admin/settings`;
- schema test calls `POST /api/admin/notion/schema`;
- sync panel calls `POST /api/admin/sync` and displays `/api/admin/sync-runs`;
- posts table calls `/api/admin/posts`.

Use compact operational UI: tabs, tables, form fields, status badges, and clear error messages.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npm test -- tests/admin-ui.test.tsx
npm run build
```

Expected: admin UI test passes and build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/routes/admin.tsx app/components/admin tests/admin-ui.test.tsx
git commit -m "feat: add admin console ui"
```

## Task 13: Final Integration and Deployment Verification

**Files:**
- Modify: `README.md`
- Modify: `wrangler.json` after D1 creation
- Update: generated `worker-configuration.d.ts` after typegen

- [ ] **Step 1: Apply D1 migration locally**

Run:

```bash
npx wrangler d1 migrations apply 233-life-notion-blog --local
```

Expected: migration applies without SQL errors.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run check
```

Expected: all tests pass; TypeScript passes; React Router build and Wrangler dry run succeed.

- [ ] **Step 3: Start local dev server**

Run:

```bash
npm run dev
```

Expected: local server starts and prints a localhost URL, normally `http://localhost:5173`.

- [ ] **Step 4: Browser smoke test**

Open the local URL and verify:

- `/` renders the blog home shell;
- `/admin` renders the password form;
- `/api/health` returns `{ "ok": true }`;
- login with `123456` works before a password hash has been saved;
- admin settings page can save Notion database URL and token;
- schema test returns recommended mappings once the Notion integration has access.

- [ ] **Step 5: Document setup**

Update `README.md` with:

```md
## Notion Blog Setup

1. Create Cloudflare resources:
   `npx wrangler d1 create 233-life-notion-blog`
   `npx wrangler r2 bucket create 233-life-notion-blog-assets`
2. Replace the D1 `database_id` in `wrangler.json` with the created id.
3. Set the encryption key:
   `npx wrangler secret put CONFIG_ENCRYPTION_KEY`
4. Apply migrations:
   `npx wrangler d1 migrations apply 233-life-notion-blog`
5. Deploy:
   `npm run deploy`
6. Open `/admin`, log in with `123456`, change the password, and configure Notion.
```

- [ ] **Step 6: Commit**

```bash
git add README.md wrangler.json worker-configuration.d.ts
git commit -m "docs: add deployment setup"
```

## Self-Review

- Spec coverage: storage, auth, public APIs, admin APIs, field mapping, sync, frontend pages, error handling, tests, and deployment are each represented by at least one task.
- Placeholder scan: the only dynamic deployment value is the Cloudflare D1 UUID returned by `wrangler d1 create`; the plan gives the exact command and replacement rule.
- Type consistency: `AppEnv`, `FieldMapping`, `SiteSettings`, public post records, and API error shapes are introduced before use.
- TDD discipline: every behavior task starts with a failing test and a command that verifies the expected failure before implementation.
