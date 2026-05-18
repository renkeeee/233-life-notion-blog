import { describe, expect, it } from "vitest";
import { handleAdminApi, validateLoginBody } from "../workers/api/admin";
import type { AppEnv } from "../workers/types";

const env: AppEnv = {
	DB: {} as D1Database,
	BLOG_ASSETS: {} as R2Bucket,
	CONFIG_ENCRYPTION_KEY: "test-encryption-key",
};

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
});

describe("admin API routes", () => {
	it("accepts a login body without echoing password details", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/login", {
				body: JSON.stringify({ password: "secret" }),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			env,
		);

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toEqual({ ok: true });
		expect(JSON.stringify(body)).not.toContain("secret");
		expect(JSON.stringify(body)).not.toContain("6");
	});

	it("returns the temporary unauthenticated admin identity", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/me", { method: "GET" }),
			env,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ authenticated: false });
	});

	it("returns the admin not found shape for unknown admin routes", async () => {
		const response = await handleAdminApi(
			adminRequest("/api/admin/nope", { method: "GET" }),
			env,
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
			env,
		);

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: { code: "BAD_REQUEST", message: "Invalid request body" },
		});
	});
});
