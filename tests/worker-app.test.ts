import { describe, expect, it } from "vitest";
import worker from "../workers/app";

describe("Worker API routing", () => {
	it("returns health JSON from /api/health", async () => {
		const response = await worker.fetch(
			new Request("https://example.test/api/health"),
			{} as Env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("returns JSON 404 for unknown API requests", async () => {
		const response = await worker.fetch(
			new Request("https://example.test/api/missing"),
			{} as Env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).toContain("application/json");
		await expect(response.json()).resolves.toEqual({ error: "Not found" });
	});

	it("returns plain 404 for non-API requests", async () => {
		const response = await worker.fetch(
			new Request("https://example.test/posts/example"),
			{} as Env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(404);
		expect(response.headers.get("content-type")).not.toContain(
			"application/json",
		);
		await expect(response.text()).resolves.toBe("Not found");
	});
});
