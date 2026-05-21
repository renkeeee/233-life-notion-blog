import { handleAdminApi } from "./api/admin";
import {
	handlePublicApi,
	handleRobots,
	handleRss,
	handleSitemap,
} from "./api/public";
import { handleAppRequest } from "./seo";
import { runSync } from "./sync";
import type { AppEnv } from "./types";

export function routeKind(
	request: Request,
): "api" | "sitemap" | "rss" | "robots" | "app" {
	const { pathname } = new URL(request.url);

	if (pathname === "/sitemap.xml") {
		return "sitemap";
	}

	if (pathname === "/rss.xml" || pathname === "/feed.xml") {
		return "rss";
	}

	if (pathname === "/robots.txt") {
		return "robots";
	}

	return pathname === "/api" || pathname.startsWith("/api/") ? "api" : "app";
}

function isLocalHostname(hostname: string): boolean {
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		hostname === "::1"
	);
}

export function redirectHttpToHttps(request: Request): Response | null {
	const url = new URL(request.url);

	if (url.protocol !== "http:" || isLocalHostname(url.hostname)) {
		return null;
	}

	url.protocol = "https:";
	return Response.redirect(url.toString(), 308);
}

function isAdminApiPath(pathname: string): boolean {
	return pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

export default {
	fetch(request, env, _ctx) {
		const redirect = redirectHttpToHttps(request);
		if (redirect) {
			return redirect;
		}

		const url = new URL(request.url);
		const kind = routeKind(request);

		if (kind === "sitemap") {
			return handleSitemap(request, env);
		}

		if (kind === "rss") {
			return handleRss(request, env);
		}

		if (kind === "robots") {
			return handleRobots(request);
		}

		if (kind === "api") {
			if (isAdminApiPath(url.pathname)) {
				return handleAdminApi(request, env);
			}

			return handlePublicApi(request, env);
		}

		return handleAppRequest(request, env);
	},
	scheduled(_controller, env, ctx) {
		ctx.waitUntil(runSync(env, { triggerType: "cron", force: false }));
	},
} satisfies ExportedHandler<AppEnv>;
