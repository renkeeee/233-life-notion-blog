import { handlePublicApi } from "./api/public";
import { errorJson } from "./http";
import type { AppEnv } from "./types";

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
			return errorJson("NOT_FOUND", "Route not found", 404);
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<AppEnv>;
