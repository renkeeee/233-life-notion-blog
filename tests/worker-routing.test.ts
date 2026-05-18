import { describe, expect, it } from "vitest";
import worker, { routeKind } from "../workers/app";
import type { AppEnv } from "../workers/types";

type WorkerRequest = Parameters<NonNullable<typeof worker.fetch>>[0];

const env: AppEnv = {
	DB: {} as D1Database,
	BLOG_ASSETS: {} as R2Bucket,
	CONFIG_ENCRYPTION_KEY: "test-encryption-key",
};

function workerRequest(pathname: string): WorkerRequest {
	return new Request(`https://example.test${pathname}`) as WorkerRequest;
}

describe("worker route kind", () => {
	it.each(["/api", "/api/posts", "/api/admin/login"])(
		"routes %s as api",
		(pathname) => {
			expect(routeKind(workerRequest(pathname))).toBe("api");
		},
	);

	it("routes non-api paths as app", () => {
		expect(routeKind(workerRequest("/posts/example"))).toBe("app");
	});
});

describe("worker API dispatch", () => {
	it("dispatches admin me requests to the admin handler", async () => {
		const response = await worker.fetch(
			workerRequest("/api/admin/me"),
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ authenticated: false });
	});

	it("keeps public health API routing intact", async () => {
		const response = await worker.fetch(
			workerRequest("/api/health"),
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("uses the admin 404 shape under /api/admin", async () => {
		const response = await worker.fetch(
			workerRequest("/api/admin/nope"),
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: { code: "NOT_FOUND", message: "Admin API route not found" },
		});
	});
});
