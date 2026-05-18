import { handleAdminApi } from "./api/admin";
import { handlePublicApi } from "./api/public";
import { runSync } from "./sync";
import type { AppEnv } from "./types";

export function routeKind(request: Request): "api" | "app" {
	const { pathname } = new URL(request.url);

	return pathname === "/api" || pathname.startsWith("/api/") ? "api" : "app";
}

function isAdminApiPath(pathname: string): boolean {
	return pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

export default {
	fetch(request, env, _ctx) {
		const url = new URL(request.url);

		if (routeKind(request) === "api") {
			if (isAdminApiPath(url.pathname)) {
				return handleAdminApi(request, env);
			}

			return handlePublicApi(request, env);
		}

		return new Response("Not found", { status: 404 });
	},
	scheduled(_controller, env, ctx) {
		ctx.waitUntil(runSync(env, { triggerType: "cron", force: false }));
	},
} satisfies ExportedHandler<AppEnv>;
