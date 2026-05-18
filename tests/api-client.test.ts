import { describe, expect, it, vi } from "vitest";
import { apiGet, apiPost, apiPut } from "../app/lib/api-client";

describe("apiGet", () => {
	it("fetches JSON API responses", async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
			}),
		);

		await expect(apiGet("/api/health", fetcher)).resolves.toEqual({
			ok: true,
		});
		expect(fetcher).toHaveBeenCalledWith("/api/health", {
			credentials: "same-origin",
		});
	});
});

describe("apiPost", () => {
	it("sends JSON API requests with optional CSRF", async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
			}),
		);

		await expect(
			apiPost("/api/admin/sync", { force: true }, "csrf-token", fetcher),
		).resolves.toEqual({ ok: true });
		expect(fetcher).toHaveBeenCalledWith("/api/admin/sync", {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"content-type": "application/json",
				"x-csrf-token": "csrf-token",
			},
			body: JSON.stringify({ force: true }),
		});
	});
});

describe("apiPut", () => {
	it("sends JSON API requests with CSRF", async () => {
		const fetcher = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				headers: { "content-type": "application/json" },
			}),
		);

		await expect(
			apiPut("/api/admin/settings", { siteTitle: "Blog" }, "csrf-token", fetcher),
		).resolves.toEqual({ ok: true });
		expect(fetcher).toHaveBeenCalledWith("/api/admin/settings", {
			method: "PUT",
			credentials: "same-origin",
			headers: {
				"content-type": "application/json",
				"x-csrf-token": "csrf-token",
			},
			body: JSON.stringify({ siteTitle: "Blog" }),
		});
	});
});
