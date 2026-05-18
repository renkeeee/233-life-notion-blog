import { describe, expect, it } from "vitest";
import worker from "../workers/app";
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

describe("Worker API routing", () => {
	it("returns health JSON from /api/health", async () => {
		const response = await worker.fetch(
			workerRequest("/api/health"),
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("returns JSON 404 for unknown API requests", async () => {
		const response = await worker.fetch(
			workerRequest("/api/missing"),
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.json()).resolves.toEqual({ error: "Not found" });
	});

	it("treats /api as an API request", async () => {
		const response = await worker.fetch(
			workerRequest("/api"),
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.json()).resolves.toEqual({ error: "Not found" });
	});

	it("returns plain 404 for non-API requests", async () => {
		const response = await worker.fetch(
			workerRequest("/posts/example"),
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).not.toContain(
			"application/json",
		);
		await expect(response.text()).resolves.toBe("Not found");
	});
});
