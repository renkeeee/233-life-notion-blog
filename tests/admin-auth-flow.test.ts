import { describe, expect, it, vi } from "vitest";
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

type SyncRunRow = {
	id: string;
	trigger_type: "cron" | "manual";
	started_at: string;
	finished_at: string | null;
	status: "running" | "success" | "partial" | "failed";
	range_start: string | null;
	range_end: string | null;
	force: 0 | 1;
	created_count: number;
	updated_count: number;
	metadata_only_count: number;
	skipped_count: number;
	unpublished_count: number;
	archived_count: number;
	failed_count: number;
	error_code: string | null;
	error_message: string | null;
};

function createFakeD1(initialRows: SettingRow[] = []): {
	db: D1Database;
	rows: Map<string, SettingRow>;
	syncRuns: SyncRunRow[];
} {
	const rows = new Map(initialRows.map((row) => [row.key, row]));
	const syncRuns: SyncRunRow[] = [];
	function allRows<T>(sql: string): D1Result<T> {
		if (sql.includes("FROM sync_runs")) {
			return {
				results: syncRuns as T[],
				success: true,
			} as D1Result<T>;
		}

		return {
			results: Array.from(rows.values()).sort((left, right) =>
				left.key.localeCompare(right.key),
			) as T[],
			success: true,
		} as D1Result<T>;
	}

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
						async all<T>() {
							return allRows<T>(sql);
						},
					};
				},
				async all<T>() {
					return allRows<T>(sql);
				},
			};
		},
		async batch(statements: Array<{ run: () => Promise<void> }>) {
			await Promise.all(statements.map((statement) => statement.run()));
			return [];
		},
	} as unknown as D1Database;

	return { db, rows, syncRuns };
}

function createStorageFailingD1(initialRows: SettingRow[] = []): {
	db: D1Database;
	rows: Map<string, SettingRow>;
} {
	const fake = createFakeD1(initialRows);

	return {
		db: {
			...fake.db,
			async batch() {
				throw new Error("D1 unavailable: secret details");
			},
		} as unknown as D1Database,
		rows: fake.rows,
	};
}

function createListFailingD1(initialRows: SettingRow[] = []): {
	db: D1Database;
	rows: Map<string, SettingRow>;
} {
	const fake = createFakeD1(initialRows);
	const db = {
		...fake.db,
		prepare(sql: string) {
			const statement = fake.db.prepare(sql);

			if (sql.includes("ORDER BY key")) {
				return {
					...statement,
					async all() {
						throw new Error("D1 list unavailable: secret details");
					},
				};
			}

			return statement;
		},
	} as unknown as D1Database;

	return { db, rows: fake.rows };
}

function testEnv(rootKey = generateEncryptionKey(), rows: SettingRow[] = []): {
	env: AppEnv;
	rows: Map<string, SettingRow>;
	rootKey: string;
	syncRuns: SyncRunRow[];
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
		syncRuns: fake.syncRuns,
	};
}

function storageFailingEnv(
	rootKey = generateEncryptionKey(),
	rows: SettingRow[] = [],
): {
	env: AppEnv;
	rows: Map<string, SettingRow>;
	rootKey: string;
} {
	const fake = createStorageFailingD1(rows);

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

function listFailingEnv(
	rootKey = generateEncryptionKey(),
	rows: SettingRow[] = [],
): {
	env: AppEnv;
	rows: Map<string, SettingRow>;
	rootKey: string;
} {
	const fake = createListFailingD1(rows);

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

async function usableAdminSession(env: AppEnv): Promise<{
	cookie: string;
	csrfToken: string;
}> {
	const session = await loginSession(env);
	const response = await changePassword(env, session, {
		currentPassword: "123456",
		newPassword: "changed-password",
	});

	expect(response.status).toBe(200);

	return session;
}

async function changePassword(
	env: AppEnv,
	session: { cookie: string; csrfToken: string },
	body: Record<string, unknown>,
	init: RequestInit = {},
): Promise<Response> {
	return handleAdminApi(
		adminRequest("/api/admin/password", {
			body: JSON.stringify(body),
			headers: {
				"content-type": "application/json",
				cookie: session.cookie,
				"x-csrf-token": session.csrfToken,
				...(init.headers ?? {}),
			},
			method: "POST",
			...init,
		}),
		env,
	);
}

function testSettings(notionToken = "ntn_secret"): SiteSettings {
	return {
		siteTitle: "233 Life",
		notionDatabaseUrl:
			"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
		notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
		notionToken,
		cdnBaseUrl: "https://cdn.example.com",
		fieldMapping: { title: "Name", status: "Status" },
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
	it("accepts the initial password, sets a Secure HttpOnly session cookie, returns CSRF and mustChangePassword, and stores a PBKDF2 hash", async () => {
		const { env, rows } = testEnv();
		const response = await login(env);
		const body = await response.json();
		const cookie = response.headers.get("set-cookie") ?? "";
		const passwordRow = rows.get("adminPasswordHash");

		expect(response.status).toBe(200);
		expect(body).toEqual({
			authenticated: true,
			csrfToken: expect.any(String),
			mustChangePassword: true,
		});
		expect(body).not.toHaveProperty("password");
		expect(String(body)).not.toContain("123456");
		expect(cookie).toContain("admin_session=");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Secure");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Path=/");
		expect(cookie).toContain("Max-Age=604800");
		expect(passwordRow?.encrypted).toBe(0);
		expect(passwordRow?.value).toMatch(/^pbkdf2-sha256:100000:/);
		expect(passwordRow?.value).not.toBe("123456");
		expect(JSON.stringify(body)).not.toContain("123456");
	});

	it("requires a session and matching CSRF token to change the admin password", async () => {
		const { env } = testEnv();
		const session = await loginSession(env);
		const unauthenticatedResponse = await handleAdminApi(
			adminRequest("/api/admin/password", {
				body: JSON.stringify({
					currentPassword: "123456",
					newPassword: "changed-password",
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			env,
		);
		const missingCsrfResponse = await handleAdminApi(
			adminRequest("/api/admin/password", {
				body: JSON.stringify({
					currentPassword: "123456",
					newPassword: "changed-password",
				}),
				headers: {
					"content-type": "application/json",
					cookie: session.cookie,
				},
				method: "POST",
			}),
			env,
		);

		expect(unauthenticatedResponse.status).toBe(401);
		expect(missingCsrfResponse.status).toBe(403);
		await expect(missingCsrfResponse.json()).resolves.toEqual({
			error: { code: "FORBIDDEN", message: "Invalid CSRF token" },
		});
	});

	it("rejects default, too short, and too long replacement passwords", async () => {
		const { env } = testEnv();
		const session = await loginSession(env);
		const defaultResponse = await changePassword(env, session, {
			currentPassword: "123456",
			newPassword: "123456",
		});
		const shortResponse = await changePassword(env, session, {
			currentPassword: "123456",
			newPassword: "short",
		});
		const longResponse = await changePassword(env, session, {
			currentPassword: "123456",
			newPassword: "a".repeat(1025),
		});

		expect(defaultResponse.status).toBe(400);
		expect(shortResponse.status).toBe(400);
		expect(longResponse.status).toBe(400);
		await expect(defaultResponse.json()).resolves.toEqual({
			error: {
				code: "BAD_REQUEST",
				message: "New password cannot be the initial password",
			},
		});
	});

	it("rejects overlong current passwords before verifying credentials", async () => {
		const { env } = testEnv();
		const session = await loginSession(env);
		const response = await changePassword(env, session, {
			currentPassword: "a".repeat(1025),
			newPassword: "changed-password",
		});

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "BAD_REQUEST",
				message: "Current password must be at most 1024 characters",
			},
		});
	});

	it("updates the stored password hash and stops accepting the bootstrap password", async () => {
		const { env, rows } = testEnv();
		const session = await loginSession(env);
		const changeResponse = await changePassword(env, session, {
			currentPassword: "123456",
			newPassword: "changed-password",
		});
		const oldPasswordResponse = await login(env, "123456");
		const newPasswordResponse = await login(env, "changed-password");
		const newPasswordBody = await newPasswordResponse.json();

		expect(changeResponse.status).toBe(200);
		await expect(changeResponse.json()).resolves.toEqual({ ok: true });
		expect(rows.get("adminPasswordHash")?.value).not.toContain("123456");
		expect(oldPasswordResponse.status).toBe(401);
		expect(newPasswordResponse.status).toBe(200);
		expect(newPasswordBody).toEqual({
			authenticated: true,
			csrfToken: expect.any(String),
		});
		expect(newPasswordBody).not.toHaveProperty("mustChangePassword");
	});

	it("does not treat a malformed stored password hash as missing bootstrap state", async () => {
		const { env, rows } = testEnv(generateEncryptionKey(), [
			settingRow("adminPasswordHash", "not-a-password-hash"),
		]);
		const response = await login(env, "123456");

		expect(response.status).toBe(401);
		expect(rows.get("adminPasswordHash")?.value).toBe("not-a-password-hash");
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
			mustChangePassword: true,
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
		expect(cookie).toContain("Secure");
	});
});

describe("admin settings API", () => {
	it("blocks settings access for bootstrap-password sessions until the password changes", async () => {
		const { env } = testEnv();
		const session = await loginSession(env);
		const getBeforeChange = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				headers: { cookie: session.cookie },
				method: "GET",
			}),
			env,
		);
		const putBeforeChange = await handleAdminApi(
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
		const passwordResponse = await changePassword(env, session, {
			currentPassword: "123456",
			newPassword: "changed-password",
		});
		const putAfterChange = await handleAdminApi(
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
		const getAfterChange = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				headers: { cookie: session.cookie },
				method: "GET",
			}),
			env,
		);

		expect(getBeforeChange.status).toBe(403);
		await expect(getBeforeChange.json()).resolves.toEqual({
			error: { code: "FORBIDDEN", message: "Password change required" },
		});
		expect(putBeforeChange.status).toBe(403);
		await expect(putBeforeChange.json()).resolves.toEqual({
			error: { code: "FORBIDDEN", message: "Password change required" },
		});
		expect(passwordResponse.status).toBe(200);
		expect(putAfterChange.status).toBe(200);
		expect(getAfterChange.status).toBe(200);
		await expect(getAfterChange.json()).resolves.toMatchObject({
			siteTitle: "233 Life",
			notionToken: "",
			hasNotionToken: true,
		});
	});

	it("keeps subsequent default-password logins in must-change mode until changed", async () => {
		const { env } = testEnv();
		await loginSession(env);
		const secondLoginResponse = await login(env);
		const secondLoginCookie = secondLoginResponse.headers.get("set-cookie") ?? "";
		const secondLoginBody = (await secondLoginResponse.json()) as {
			csrfToken: string;
			mustChangePassword?: boolean;
		};
		const settingsResponse = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				headers: { cookie: secondLoginCookie.split(";")[0] ?? "" },
				method: "GET",
			}),
			env,
		);

		expect(secondLoginResponse.status).toBe(200);
		expect(secondLoginBody).toEqual({
			authenticated: true,
			csrfToken: expect.any(String),
			mustChangePassword: true,
		});
		expect(settingsResponse.status).toBe(403);
		await expect(settingsResponse.json()).resolves.toEqual({
			error: { code: "FORBIDDEN", message: "Password change required" },
		});
	});

	it("requires a session to read settings and returns redacted values", async () => {
		const { env, rootKey } = testEnv();
		const session = await usableAdminSession(env);
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
		const session = await usableAdminSession(env);
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

	it("returns CONFIG_DECRYPT_FAILED for corrupted encrypted settings without leaking raw errors", async () => {
		const { env, rows, rootKey } = testEnv();
		const session = await usableAdminSession(env);
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
		rows.set("notionToken", {
			...rows.get("notionToken")!,
			value: "v1.corrupted.ciphertext",
		});

		const response = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				headers: { cookie: session.cookie },
				method: "GET",
			}),
			env,
		);

		expect(rootKey).toHaveLength(43);
		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "CONFIG_DECRYPT_FAILED",
				message: "Stored settings could not be decrypted",
			},
		});
	});

	it("returns INTERNAL_ERROR for settings storage failures without leaking raw errors", async () => {
		const { env } = storageFailingEnv();
		const session = await usableAdminSession(env);
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

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "INTERNAL_ERROR",
				message: "Settings could not be saved",
			},
		});
	});

	it("returns INTERNAL_ERROR for settings load failures without leaking raw errors", async () => {
		const { env } = listFailingEnv();
		const session = await usableAdminSession(env);
		const response = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				headers: { cookie: session.cookie },
				method: "GET",
			}),
			env,
		);

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "INTERNAL_ERROR",
				message: "Settings could not be loaded",
			},
		});
	});

	it("requires CSRF to save settings, encrypts notionToken, rejects redacted and invalid settings, and returns redacted settings", async () => {
		const { env, rows, rootKey } = testEnv();
		const session = await usableAdminSession(env);
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
		await expect(invalidResponse.json()).resolves.toEqual({
			error: {
				code: "BAD_REQUEST",
				message: "Invalid setting: siteTitle",
			},
		});
		expect(invalidMappingResponse.status).toBe(400);
		await expect(invalidMappingResponse.json()).resolves.toEqual({
			error: {
				code: "BAD_REQUEST",
				message: "Invalid setting: fieldMapping",
			},
		});
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

	it("returns the invalid setting name when CDN base URL is missing", async () => {
		const { env } = testEnv();
		const session = await usableAdminSession(env);
		const response = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				body: JSON.stringify({
					...testSettings(),
					cdnBaseUrl: "",
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

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "BAD_REQUEST",
				message: "Invalid setting: cdnBaseUrl",
			},
		});
	});

	it("reuses the stored Notion token when saving settings without re-entering it", async () => {
		const { env, rows, rootKey } = testEnv();
		const session = await usableAdminSession(env);
		const initialResponse = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				body: JSON.stringify(testSettings("stored_ntn_secret")),
				headers: {
					"content-type": "application/json",
					cookie: session.cookie,
					"x-csrf-token": session.csrfToken,
				},
				method: "PUT",
			}),
			env,
		);
		expect(initialResponse.status).toBe(200);

		const updateBody = {
			...testSettings(""),
			siteTitle: "Updated Life",
			notionToken: "",
		};
		const response = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				body: JSON.stringify(updateBody),
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

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			siteTitle: "Updated Life",
			notionToken: "",
			hasNotionToken: true,
		});
		expect(tokenRow?.encrypted).toBe(1);
		expect(await decryptString(tokenRow!.value, rootKey)).toBe(
			"stored_ntn_secret",
		);
	});
});

describe("admin sync API", () => {
	it("returns recent sync runs for authenticated admins", async () => {
		const { env, syncRuns } = testEnv();
		const session = await usableAdminSession(env);
		syncRuns.push({
			id: "sync-run-1",
			trigger_type: "manual",
			started_at: "2026-05-18T12:00:00.000Z",
			finished_at: "2026-05-18T12:01:00.000Z",
			status: "success",
			range_start: "2026-05-17T00:00:00.000Z",
			range_end: "2026-05-18T00:00:00.000Z",
			force: 1,
			created_count: 1,
			updated_count: 2,
			metadata_only_count: 3,
			skipped_count: 4,
			unpublished_count: 5,
			archived_count: 6,
			failed_count: 0,
			error_code: null,
			error_message: null,
		});

		const unauthorizedResponse = await handleAdminApi(
			adminRequest("/api/admin/sync-runs", { method: "GET" }),
			env,
		);
		const response = await handleAdminApi(
			adminRequest("/api/admin/sync-runs", {
				headers: { cookie: session.cookie },
				method: "GET",
			}),
			env,
		);

		expect(unauthorizedResponse.status).toBe(401);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			items: [
				{
					id: "sync-run-1",
					trigger_type: "manual",
					started_at: "2026-05-18T12:00:00.000Z",
					finished_at: "2026-05-18T12:01:00.000Z",
					status: "success",
					range_start: "2026-05-17T00:00:00.000Z",
					range_end: "2026-05-18T00:00:00.000Z",
					force: true,
					created_count: 1,
					updated_count: 2,
					metadata_only_count: 3,
					skipped_count: 4,
					unpublished_count: 5,
					archived_count: 6,
					failed_count: 0,
					error_code: null,
					error_message: null,
				},
			],
		});
	});
});

describe("admin Notion schema API", () => {
	it("retrieves a Notion schema and returns recommended field mappings", async () => {
		const { env } = testEnv();
		const session = await usableAdminSession(env);
		const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			expect(request.url).toBe(
				"https://api.notion.com/v1/databases/3646b3023c2380fc886af37685393dd4",
			);
			expect(request.headers.get("Authorization")).toBe("Bearer ntn_secret");

			return Response.json({
				object: "database",
				id: "3646b3023c2380fc886af37685393dd4",
				properties: {
					Name: { type: "title" },
					Status: { type: "status" },
					Tags: { type: "multi_select" },
				},
			});
		});
		vi.stubGlobal("fetch", fetcher);

		try {
			const response = await handleAdminApi(
				adminRequest("/api/admin/notion/schema", {
					body: JSON.stringify({
						notionDatabaseUrl:
							"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
						notionToken: "ntn_secret",
					}),
					headers: {
						"content-type": "application/json",
						cookie: session.cookie,
						"x-csrf-token": session.csrfToken,
					},
					method: "POST",
				}),
				env,
			);

			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toEqual({
				databaseId: "3646b3023c2380fc886af37685393dd4",
				properties: {
					Name: { type: "title" },
					Status: { type: "status" },
					Tags: { type: "multi_select" },
				},
				recommendedFieldMapping: {
					title: "Name",
					status: "Status",
					tags: "Tags",
					publishedStatusValues: ["Published", "已发布"],
				},
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("uses the stored Notion token when schema testing omits a token", async () => {
		const { env } = testEnv();
		const session = await usableAdminSession(env);
		const saveResponse = await handleAdminApi(
			adminRequest("/api/admin/settings", {
				body: JSON.stringify(testSettings("stored_ntn_secret")),
				headers: {
					"content-type": "application/json",
					cookie: session.cookie,
					"x-csrf-token": session.csrfToken,
				},
				method: "PUT",
			}),
			env,
		);
		expect(saveResponse.status).toBe(200);

		const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			expect(request.headers.get("Authorization")).toBe(
				"Bearer stored_ntn_secret",
			);

			return Response.json({
				object: "database",
				id: "3646b3023c2380fc886af37685393dd4",
				properties: {
					Name: { type: "title" },
					Status: { type: "status" },
				},
			});
		});
		vi.stubGlobal("fetch", fetcher);

		try {
			const response = await handleAdminApi(
				adminRequest("/api/admin/notion/schema", {
					body: JSON.stringify({
						notionDatabaseUrl:
							"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
					}),
					headers: {
						"content-type": "application/json",
						cookie: session.cookie,
						"x-csrf-token": session.csrfToken,
					},
					method: "POST",
				}),
				env,
			);

			expect(response.status).toBe(200);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("returns Notion validation messages when schema loading fails", async () => {
		const { env } = testEnv();
		const session = await usableAdminSession(env);
		const fetcher = vi.fn(async () =>
			Response.json(
				{
					object: "error",
					status: 400,
					code: "validation_error",
					message: "path failed validation: database_id is invalid",
				},
				{ status: 400 },
			),
		);
		vi.stubGlobal("fetch", fetcher);

		try {
			const response = await handleAdminApi(
				adminRequest("/api/admin/notion/schema", {
					body: JSON.stringify({
						notionDatabaseUrl:
							"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
						notionToken: "ntn_secret",
					}),
					headers: {
						"content-type": "application/json",
						cookie: session.cookie,
						"x-csrf-token": session.csrfToken,
					},
					method: "POST",
				}),
				env,
			);

			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({
				error: {
					code: "BAD_REQUEST",
					message:
						"Notion schema could not be loaded: path failed validation: database_id is invalid",
				},
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("returns unexpected schema loading error messages for diagnostics", async () => {
		const { env } = testEnv();
		const session = await usableAdminSession(env);
		const fetcher = vi.fn(async () => {
			throw new TypeError("fetch failed");
		});
		vi.stubGlobal("fetch", fetcher);

		try {
			const response = await handleAdminApi(
				adminRequest("/api/admin/notion/schema", {
					body: JSON.stringify({
						notionDatabaseUrl:
							"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
						notionToken: "ntn_secret",
					}),
					headers: {
						"content-type": "application/json",
						cookie: session.cookie,
						"x-csrf-token": session.csrfToken,
					},
					method: "POST",
				}),
				env,
			);

			expect(response.status).toBe(500);
			await expect(response.json()).resolves.toEqual({
				error: {
					code: "INTERNAL_ERROR",
					message: "Notion schema could not be loaded: fetch failed",
				},
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
