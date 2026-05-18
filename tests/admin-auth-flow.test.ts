import { describe, expect, it } from "vitest";
import { handleAdminApi } from "../workers/api/admin";
import { shouldBootstrapPassword } from "../workers/auth";
import { decryptString, generateEncryptionKey } from "../workers/crypto";
import type { SettingRow } from "../workers/settings";
import type { AppEnv, SiteSettings } from "../workers/types";

function settingRow(
	key: string,
	value: string,
	encrypted: 0 | 1 = 0,
): SettingRow {
	return {
		key,
		value,
		encrypted,
		updated_at: "2026-05-19T00:00:00.000Z",
	};
}

function createFakeD1(initialRows: SettingRow[] = []): {
	db: D1Database;
	rows: Map<string, SettingRow>;
} {
	const rows = new Map(initialRows.map((row) => [row.key, row]));
	const db = {
		prepare(sql: string) {
			return {
				bind(...values: unknown[]) {
					return {
						async first<T>() {
							const key = String(values[0]);
							return (rows.get(key) ?? null) as T | null;
						},
						async run() {
							const [key, value, encrypted, updatedAt] = values;
							rows.set(String(key), {
								key: String(key),
								value: String(value),
								encrypted: encrypted as 0 | 1,
								updated_at: String(updatedAt),
							});
						},
					};
				},
				async all<T>() {
					return {
						results: Array.from(rows.values()).sort((left, right) =>
							left.key.localeCompare(right.key),
						) as T[],
						success: true,
					};
				},
			};
		},
		async batch(statements: Array<{ run: () => Promise<void> }>) {
			await Promise.all(statements.map((statement) => statement.run()));
			return [];
		},
	} as unknown as D1Database;

	return { db, rows };
}

function testEnv(rootKey = generateEncryptionKey(), rows: SettingRow[] = []): {
	env: AppEnv;
	rows: Map<string, SettingRow>;
	rootKey: string;
} {
	const fake = createFakeD1(rows);

	return {
		env: {
			DB: fake.db,
			BLOG_ASSETS: {} as R2Bucket,
			CONFIG_ENCRYPTION_KEY: rootKey,
		},
		rows: fake.rows,
		rootKey,
	};
}

function adminRequest(pathname: string, init: RequestInit = {}): Request {
	return new Request(`https://example.test${pathname}`, init);
}

async function login(env: AppEnv, password = "123456"): Promise<Response> {
	return handleAdminApi(
		adminRequest("/api/admin/login", {
			body: JSON.stringify({ password }),
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		env,
	);
}

async function loginSession(env: AppEnv): Promise<{
	cookie: string;
	csrfToken: string;
}> {
	const response = await login(env);
	const cookie = response.headers.get("set-cookie") ?? "";
	const body = (await response.json()) as { csrfToken: string };

	return {
		cookie: cookie.split(";")[0] ?? "",
		csrfToken: body.csrfToken,
	};
}

function testSettings(notionToken = "ntn_secret"): SiteSettings {
	return {
		siteTitle: "233 Life",
		notionDatabaseUrl: "https://www.notion.so/example/database",
		notionDatabaseId: "database-id",
		notionToken,
		cdnBaseUrl: "https://cdn.example.com",
		fieldMapping: { title: "Name", status: "Status", tags: "Tags" },
	};
}

describe("admin password bootstrap", () => {
	it("only bootstraps missing password hashes", () => {
		expect(shouldBootstrapPassword(null)).toBe(true);
		expect(shouldBootstrapPassword("pbkdf2-sha256:210000:salt:hash")).toBe(
			false,
		);
	});
});

describe("admin authentication flow", () => {
	it("accepts the initial password, sets an HttpOnly session cookie, returns CSRF, and stores a PBKDF2 hash", async () => {
		const { env, rows } = testEnv();
		const response = await login(env);
		const body = await response.json();
		const cookie = response.headers.get("set-cookie") ?? "";
		const passwordRow = rows.get("adminPasswordHash");

		expect(response.status).toBe(200);
		expect(body).toEqual({
			authenticated: true,
			csrfToken: expect.any(String),
		});
		expect(body).not.toHaveProperty("password");
		expect(String(body)).not.toContain("123456");
		expect(cookie).toContain("admin_session=");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("Max-Age=604800");
		expect(passwordRow?.encrypted).toBe(0);
		expect(passwordRow?.value).toMatch(/^pbkdf2-sha256:210000:/);
		expect(passwordRow?.value).not.toBe("123456");
		expect(JSON.stringify(body)).not.toContain("123456");
	});

	it("rejects wrong passwords without setting a session cookie", async () => {
		const { env } = testEnv();
		const response = await login(env, "wrong-password");

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({
			error: { code: "UNAUTHORIZED", message: "Invalid credentials" },
		});
		expect(response.headers.has("set-cookie")).toBe(false);
	});

	it("reports valid and invalid admin sessions from /me", async () => {
		const { env } = testEnv();
		const session = await loginSession(env);

		const validResponse = await handleAdminApi(
			adminRequest("/api/admin/me", {
				headers: { cookie: session.cookie },
				method: "GET",
			}),
			env,
		);
		const invalidResponse = await handleAdminApi(
			adminRequest("/api/admin/me", {
				headers: { cookie: "admin_session=not-a-token" },
				method: "GET",
			}),
			env,
		);

		expect(validResponse.status).toBe(200);
		await expect(validResponse.json()).resolves.toEqual({
			authenticated: true,
			csrfToken: session.csrfToken,
		});
		expect(invalidResponse.status).toBe(200);
		await expect(invalidResponse.json()).resolves.toEqual({
			authenticated: false,
		});
	});

	it("requires a valid session and matching CSRF token to log out", async () => {
		const { env } = testEnv();
		const session = await loginSession(env);
		const missingCsrfResponse = await handleAdminApi(
			adminRequest("/api/admin/logout", {
				headers: { cookie: session.cookie },
				method: "POST",
			}),
			env,
		);
		const logoutResponse = await handleAdminApi(
			adminRequest("/api/admin/logout", {
				headers: {
					cookie: session.cookie,
					"x-csrf-token": session.csrfToken,
				},
				method: "POST",
			}),
			env,
		);
		const cookie = logoutResponse.headers.get("set-cookie") ?? "";

		expect(missingCsrfResponse.status).toBe(403);
		await expect(missingCsrfResponse.json()).resolves.toEqual({
			error: { code: "FORBIDDEN", message: "Invalid CSRF token" },
		});
		expect(logoutResponse.status).toBe(200);
		await expect(logoutResponse.json()).resolves.toEqual({
			authenticated: false,
		});
		expect(cookie).toContain("admin_session=");
		expect(cookie).toContain("Max-Age=0");
		expect(cookie).toContain("HttpOnly");
	});
});

describe("admin settings API", () => {
	it("requires a session to read settings and returns redacted values", async () => {
		const { env, rootKey } = testEnv();
		const session = await loginSession(env);
		await handleAdminApi(
			adminRequest("/api/admin/settings", {
				body: JSON.stringify(testSettings()),
				headers: {
					"content-type": "application/json",
					cookie: session.cookie,
					"x-csrf-token": session.csrfToken,
				},
				method: "PUT",
			}),
			env,
		);

		const unauthorizedResponse = await handleAdminApi(
			adminRequest("/api/admin/settings", { method: "GET" }),
			env,
		);
		const response = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				headers: { cookie: session.cookie },
				method: "GET",
			}),
			env,
		);

		expect(rootKey).toHaveLength(43);
		expect(unauthorizedResponse.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({
			siteTitle: "233 Life",
			notionToken: "",
			hasNotionToken: true,
		});
	});

	it("returns NOT_FOUND when site settings have not been saved", async () => {
		const { env } = testEnv();
		const session = await loginSession(env);
		const response = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				headers: { cookie: session.cookie },
				method: "GET",
			}),
			env,
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: { code: "NOT_FOUND", message: "Settings not found" },
		});
	});

	it("requires CSRF to save settings, encrypts notionToken, rejects redacted and invalid settings, and returns redacted settings", async () => {
		const { env, rows, rootKey } = testEnv();
		const session = await loginSession(env);
		const missingCsrfResponse = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				body: JSON.stringify(testSettings()),
				headers: {
					"content-type": "application/json",
					cookie: session.cookie,
				},
				method: "PUT",
			}),
			env,
		);
		const invalidResponse = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				body: JSON.stringify({ ...testSettings(), siteTitle: "" }),
				headers: {
					"content-type": "application/json",
					cookie: session.cookie,
					"x-csrf-token": session.csrfToken,
				},
				method: "PUT",
			}),
			env,
		);
		const invalidMappingResponse = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				body: JSON.stringify({
					...testSettings(),
					fieldMapping: { title: "Name" },
				}),
				headers: {
					"content-type": "application/json",
					cookie: session.cookie,
					"x-csrf-token": session.csrfToken,
				},
				method: "PUT",
			}),
			env,
		);
		const redactedResponse = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				body: JSON.stringify({
					...testSettings(""),
					hasNotionToken: true,
				}),
				headers: {
					"content-type": "application/json",
					cookie: session.cookie,
					"x-csrf-token": session.csrfToken,
				},
				method: "PUT",
			}),
			env,
		);
		const response = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				body: JSON.stringify(testSettings()),
				headers: {
					"content-type": "application/json",
					cookie: session.cookie,
					"x-csrf-token": session.csrfToken,
				},
				method: "PUT",
			}),
			env,
		);
		const tokenRow = rows.get("notionToken");

		expect(missingCsrfResponse.status).toBe(403);
		expect(invalidResponse.status).toBe(400);
		expect(invalidMappingResponse.status).toBe(400);
		expect(redactedResponse.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			siteTitle: "233 Life",
			notionToken: "",
			hasNotionToken: true,
		});
		expect(tokenRow?.encrypted).toBe(1);
		expect(tokenRow?.value).not.toBe("ntn_secret");
		expect(await decryptString(tokenRow!.value, rootKey)).toBe("ntn_secret");
	});
});
