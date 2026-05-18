import { describe, expect, it } from "vitest";
import { handleAdminApi, validateLoginBody } from "../workers/api/admin";
import { generateEncryptionKey } from "../workers/crypto";
import type { SettingRow } from "../workers/settings";
import type { AppEnv } from "../workers/types";

function createFakeD1(): D1Database {
	const rows = new Map<string, SettingRow>();

	return {
		prepare() {
			return {
				bind(...values: unknown[]) {
					return {
						async first<T>() {
							return (rows.get(String(values[0])) ?? null) as T | null;
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
					return { results: Array.from(rows.values()) as T[], success: true };
				},
			};
		},
	} as unknown as D1Database;
}

function testEnv(): AppEnv {
	return {
		DB: createFakeD1(),
		BLOG_ASSETS: {} as R2Bucket,
		CONFIG_ENCRYPTION_KEY: generateEncryptionKey(),
	};
}

function adminRequest(
	pathname: string,
	init: RequestInit = {},
): Request {
	return new Request(`https://example.test${pathname}`, init);
}

describe("admin login validation", () => {
	it("accepts a non-empty string password", () => {
		expect(validateLoginBody({ password: "secret" })).toEqual({
			password: "secret",
		});
	});

	it.each([
		["missing", {}],
		["empty", { password: "" }],
		["non-string", { password: 123 }],
	])("rejects %s password", (_name, body) => {
		expect(() => validateLoginBody(body)).toThrow("Password is required");
	});

	it("rejects overlong passwords", () => {
		expect(() => validateLoginBody({ password: "a".repeat(1025) })).toThrow(
			"Password must be at most 1024 characters",
		);
	});
});

describe("admin API routes", () => {
	it("logs in without echoing password details", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/login", {
				body: JSON.stringify({ password: "123456" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			testEnv(),
		);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual({
			authenticated: true,
			csrfToken: expect.any(String),
			mustChangePassword: true,
		});
		expect(body).not.toHaveProperty("password");
		expect(body).not.toHaveProperty("passwordLength");
		expect(JSON.stringify(body)).not.toContain("123456");
	});

	it("returns the unauthenticated admin identity when no session exists", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/me", { method: "GET" }),
			testEnv(),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ authenticated: false });
	});

	it("returns the admin not found shape for unknown admin routes", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/nope", { method: "GET" }),
			testEnv(),
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: { code: "NOT_FOUND", message: "Admin API route not found" },
		});
	});

	it("returns bad request JSON for invalid login JSON", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/login", {
				body: "{",
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			testEnv(),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: { code: "BAD_REQUEST", message: "Invalid request body" },
		});
	});

	it.each([
		["missing", {}],
		["empty", { password: "" }],
		["non-string", { password: 123 }],
	])("returns bad request JSON for %s login password", async (_name, body) => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/login", {
				body: JSON.stringify(body),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			testEnv(),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: { code: "BAD_REQUEST", message: "Password is required" },
		});
	});

	it("returns bad request JSON for overlong login passwords", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/login", {
				body: JSON.stringify({ password: "a".repeat(1025) }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			testEnv(),
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "BAD_REQUEST",
				message: "Password must be at most 1024 characters",
			},
		});
	});
});
