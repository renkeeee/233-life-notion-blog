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
