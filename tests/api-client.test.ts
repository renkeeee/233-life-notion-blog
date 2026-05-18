import { describe, expect, it, vi } from "vitest";
import { apiGet } from "../app/lib/api-client";

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
