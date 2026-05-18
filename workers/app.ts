import { handlePublicApi } from "./api/public";
import type { AppEnv } from "./types";

function json(data: unknown, init?: ResponseInit) {
	const headers = new Headers(init?.headers);
	if (!headers.has("content-type")) {
		headers.set("content-type", "application/json");
	}

	return Response.json(data, {
		...init,
		headers,
	});
}

export default {
	fetch(request, env, _ctx) {
		const url = new URL(request.url);

		if (
			url.pathname === "/api/health" ||
			url.pathname === "/api/posts" ||
			url.pathname.startsWith("/api/posts/") ||
			url.pathname === "/api/tags" ||
			url.pathname === "/api/search"
		) {
			return handlePublicApi(request, env);
		}

		if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
			return json({ error: "Not found" }, { status: 404 });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<AppEnv>;
