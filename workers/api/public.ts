import { PostsRepository } from "../db/d1";
import { constantTimeEqual, decryptString } from "../crypto";
import { errorJson, json, readJsonObject } from "../http";
import type { AppEnv, PublicPostRecord } from "../types";

type PublicPostSummary = {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	coverUrl: string | null;
	coverThumbnailUrl?: string;
	category: string | null;
	tags: string[];
	publishedAt: string | null;
	updatedAt: string;
};

type CategorySummary = {
	name: string;
	count: number;
};

type ListOptions = {
	page?: number;
	limit?: number;
	tag?: string;
	category?: string;
};

type PublicPostList = {
	items: PublicPostRecord[];
	total: number;
};

type ListPostsResponseOptions = ListOptions & {
	categories?: CategorySummary[];
};

const defaultPage = 1;
const defaultLimit = 20;
const maxLimit = 100;
const listCacheControl = "public, max-age=60, stale-while-revalidate=300";
const detailCacheControl = "public, max-age=300, stale-while-revalidate=86400";

function isPublished(post: PublicPostRecord): boolean {
	return post.visibility === "published";
}

function toPublicSummary(post: PublicPostRecord): PublicPostSummary {
	const coverThumbnailUrl = thumbnailUrlForCover(post.coverUrl);

	return {
		id: post.id,
		slug: post.slug,
		title: post.title,
		excerpt: post.excerpt,
		coverUrl: post.coverUrl,
		...(coverThumbnailUrl ? { coverThumbnailUrl } : {}),
		category: post.category,
		tags: post.tags,
		publishedAt: post.publishedAt,
		updatedAt: post.updatedAt,
	};
}

export function listPostsResponse(
	result: PublicPostList,
	options: ListPostsResponseOptions = {},
) {
	const page = options.page ?? defaultPage;
	const limit = options.limit ?? defaultLimit;

	return {
		items: result.items.map(toPublicSummary),
		total: result.total,
		page,
		limit,
		...(options.categories ? { categories: options.categories } : {}),
	};
}

export function postDetailResponse(
	post: PublicPostRecord,
	markdown: string,
) {
	if (!isPublished(post)) {
		return null;
	}

	return {
		...toPublicSummary(post),
		markdown,
	};
}

function thumbnailUrlForCover(coverUrl: string | null): string | null {
	if (!coverUrl) {
		return null;
	}

	try {
		const url = new URL(coverUrl);
		if (url.hostname !== "assets.233.life" || !url.pathname.startsWith("/assets/")) {
			return null;
		}

		return `${url.origin}/cdn-cgi/image/width=440,quality=82,format=auto${url.pathname}${url.search}`;
	} catch {
		return null;
	}
}

function weakEtag(value: string): string {
	let hash = 0x811c9dc5;

	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}

	return `W/"${(hash >>> 0).toString(16)}-${value.length.toString(16)}"`;
}

function cacheableJson<T>(
	request: Request,
	body: T,
	cacheControl: string,
): Response {
	const text = JSON.stringify(body);
	const etag = weakEtag(text);
	const headers = new Headers({
		"content-type": "application/json; charset=utf-8",
		"cache-control": cacheControl,
		etag,
	});

	if (request.headers.get("if-none-match") === etag) {
		return new Response(null, { status: 304, headers });
	}

	return new Response(text, { headers });
}

function parsePositiveInteger(
	params: URLSearchParams,
	name: "page" | "limit",
	defaultValue: number,
): number | null {
	const rawValue = params.get(name);
	if (rawValue === null) {
		return defaultValue;
	}
	if (!/^[1-9]\d*$/.test(rawValue)) {
		return null;
	}

	return Number(rawValue);
}

function paginationFromParams(params: URLSearchParams) {
	const page = parsePositiveInteger(params, "page", defaultPage);
	const requestedLimit = parsePositiveInteger(params, "limit", defaultLimit);

	if (page === null || requestedLimit === null) {
		return null;
	}

	return {
		page,
		limit: Math.min(requestedLimit, maxLimit),
	};
}

function postSlugFromPath(pathname: string): string | null {
	const prefix = "/api/posts/";
	if (!pathname.startsWith(prefix)) {
		return null;
	}

	const encodedSlug = pathname.slice(prefix.length);
	if (!encodedSlug || encodedSlug.includes("/")) {
		return null;
	}

	try {
		return decodeURIComponent(encodedSlug);
	} catch {
		return null;
	}
}

function unlockSlugFromPath(pathname: string): string | null {
	const suffix = "/unlock";
	if (!pathname.endsWith(suffix)) {
		return null;
	}

	return postSlugFromPath(pathname.slice(0, -suffix.length));
}

async function passwordFromRequest(request: Request): Promise<string | null> {
	try {
		const body = await readJsonObject(request);
		return typeof body.password === "string" && body.password.length > 0
			? body.password
			: null;
	} catch {
		return null;
	}
}

function xmlEscape(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function normalizedOrigin(origin: string): string {
	return origin.replace(/\/$/, "");
}

function publicPostUrl(origin: string, slug: string): string {
	return `${normalizedOrigin(origin)}/post/${encodeURIComponent(slug)}`;
}

export function sitemapXmlResponse(
	posts: PublicPostRecord[],
	origin: string,
): string {
	const siteOrigin = normalizedOrigin(origin);
	const entries = [
		[
			"\t<url>",
			`\t\t<loc>${xmlEscape(`${siteOrigin}/`)}</loc>`,
			"\t</url>",
		].join("\n"),
		...posts.map((post) =>
			[
				"\t<url>",
				`\t\t<loc>${xmlEscape(publicPostUrl(siteOrigin, post.slug))}</loc>`,
				`\t\t<lastmod>${xmlEscape(post.updatedAt)}</lastmod>`,
				"\t</url>",
			].join("\n"),
		),
	];

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...entries,
		"</urlset>",
		"",
	].join("\n");
}

export async function handleSitemap(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Not found", { status: 404 });
	}

	const posts = await new PostsRepository(env.DB).listPublishedForSitemap();
	const xml = sitemapXmlResponse(posts, new URL(request.url).origin);

	return new Response(request.method === "HEAD" ? null : xml, {
		headers: {
			"content-type": "application/xml; charset=utf-8",
			"cache-control": "public, max-age=300",
		},
	});
}

export async function handlePublicApi(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const url = new URL(request.url);
	const posts = new PostsRepository(env.DB);

	if (request.method !== "GET" && request.method !== "POST") {
		return errorJson("NOT_FOUND", "Route not found", 404);
	}

	if (url.pathname === "/api/health") {
		return json({ ok: true });
	}

	if (url.pathname === "/api/posts") {
		const pagination = paginationFromParams(url.searchParams);
		if (!pagination) {
			return errorJson(
				"BAD_REQUEST",
				"Pagination values must be positive integers",
				400,
			);
		}

		const query = (
			url.searchParams.get("q") ??
			url.searchParams.get("search") ??
			""
		).trim();
		const tag = (url.searchParams.get("tag") ?? "").trim();
		const category = (url.searchParams.get("category") ?? "").trim();
		const includes = new Set(
			(url.searchParams.get("include") ?? "")
				.split(",")
				.map((item) => item.trim())
				.filter(Boolean),
		);
		const result = await posts.listPublished({
			...pagination,
			q: query || undefined,
			tag: tag || undefined,
			category: category || undefined,
		});
		const categories = includes.has("categories")
			? await posts.listCategories()
			: undefined;

		return cacheableJson(
			request,
			listPostsResponse(result, { ...pagination, tag, category, categories }),
			listCacheControl,
		);
	}

	if (url.pathname === "/api/tags") {
		return cacheableJson(
			request,
			{ items: await posts.listTags() },
			detailCacheControl,
		);
	}

	if (url.pathname === "/api/categories") {
		return cacheableJson(
			request,
			{ items: await posts.listCategories() },
			detailCacheControl,
		);
	}

	if (url.pathname.startsWith("/api/posts/")) {
		if (request.method === "POST") {
			const slug = unlockSlugFromPath(url.pathname);
			if (!slug) {
				return errorJson("NOT_FOUND", "Post not found", 404);
			}

			const password = await passwordFromRequest(request);
			if (!password) {
				return errorJson("BAD_REQUEST", "Password is required", 400);
			}

			const locked = await posts.findLockedBySlug(slug);
			if (!locked || !locked.lockPasswordEncrypted) {
				return errorJson("NOT_FOUND", "Post not found", 404);
			}

			const expected = await decryptString(
				locked.lockPasswordEncrypted,
				env.CONFIG_ENCRYPTION_KEY,
			);
			if (!constantTimeEqual(password, expected)) {
				return errorJson("UNAUTHORIZED", "Invalid post password", 401);
			}

			const detail = await posts.findLockedDetailBySlug(slug);
			if (!detail) {
				return errorJson("NOT_FOUND", "Post content not found", 404);
			}

			return json(postDetailResponse(detail.post, detail.markdown));
		}

		const slug = postSlugFromPath(url.pathname);
		if (!slug) {
			return errorJson("NOT_FOUND", "Post not found", 404);
		}

		const detail = await posts.findPublishedDetailBySlug(slug);
		if (detail) {
			return cacheableJson(
				request,
				postDetailResponse(detail.post, detail.markdown),
				detailCacheControl,
			);
		}

		const locked = await posts.findLockedBySlug(slug);
		if (locked) {
			return cacheableJson(
				request,
				{ locked: true, slug: locked.slug, title: locked.title },
				detailCacheControl,
			);
		}

		const post = await posts.findPublishedBySlug(slug);
		if (post) {
			return errorJson("NOT_FOUND", "Post content not found", 404);
		}

		return errorJson("NOT_FOUND", "Post not found", 404);
	}

	if (url.pathname === "/api/search") {
		const q = (url.searchParams.get("q") ?? "").trim();
		if (!q) {
			return cacheableJson(
				request,
				{ items: [], total: 0, q: "" },
				listCacheControl,
			);
		}

		const records = await posts.searchPublished(q);
		return cacheableJson(
			request,
			{
				items: records.map(toPublicSummary),
				total: records.length,
				q,
			},
			listCacheControl,
		);
	}

	return errorJson("NOT_FOUND", "Route not found", 404);
}
