import { describe, expect, it } from "vitest";
import { errorJson, json, readJsonObject } from "../workers/http";

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

	it("does not mutate passed response headers", () => {
		const headers = new Headers({ "x-test": "1" });

		const response = json({ ok: true }, 200, headers);

		expect(response.headers.get("content-type")).toContain("application/json");
		expect(response.headers.get("x-test")).toBe("1");
		expect(headers.get("content-type")).toBeNull();
	});

	it("reads JSON object request bodies", async () => {
		const request = new Request("https://example.test/api", {
			body: JSON.stringify({ name: "Ada" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});

		await expect(readJsonObject(request)).resolves.toEqual({ name: "Ada" });
	});

	it("rejects array JSON request bodies", async () => {
		const request = new Request("https://example.test/api", {
			body: JSON.stringify(["bad"]),
			headers: { "content-type": "application/json" },
			method: "POST",
		});

		await expect(readJsonObject(request)).rejects.toThrow(
			"Expected JSON object body",
		);
	});

	it("rejects invalid JSON request bodies", async () => {
		const request = new Request("https://example.test/api", {
			body: "{",
			headers: { "content-type": "application/json" },
			method: "POST",
		});

		await expect(readJsonObject(request)).rejects.toThrow(
			"Expected JSON object body",
		);
	});
});
