import { PostContentRepository, PostsRepository } from "../db/d1";
import { errorJson, json } from "../http";
import type { AppEnv, PublicPostRecord } from "../types";

type PublicPostSummary = {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	coverUrl: string | null;
	category: string | null;
	tags: string[];
	publishedAt: string | null;
	updatedAt: string;
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

const defaultPage = 1;
const defaultLimit = 20;
const maxLimit = 100;

function isPublished(post: PublicPostRecord): boolean {
	return post.visibility === "published";
}

function toPublicSummary(post: PublicPostRecord): PublicPostSummary {
	return {
		id: post.id,
		slug: post.slug,
		title: post.title,
		excerpt: post.excerpt,
		coverUrl: post.coverUrl,
		category: post.category,
		tags: post.tags,
		publishedAt: post.publishedAt,
		updatedAt: post.updatedAt,
	};
}

export function listPostsResponse(
	result: PublicPostList,
	options: ListOptions = {},
) {
	const page = options.page ?? defaultPage;
	const limit = options.limit ?? defaultLimit;

	return {
		items: result.items.map(toPublicSummary),
		total: result.total,
		page,
		limit,
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
	const content = new PostContentRepository(env.DB);

	if (request.method !== "GET") {
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
		const result = await posts.listPublished({
			...pagination,
			q: query || undefined,
			tag: tag || undefined,
			category: category || undefined,
		});

		return json(listPostsResponse(result, { ...pagination, tag, category }));
	}

	if (url.pathname === "/api/tags") {
		return json({ items: await posts.listTags() });
	}

	if (url.pathname === "/api/categories") {
		return json({ items: await posts.listCategories() });
	}

	if (url.pathname.startsWith("/api/posts/")) {
		const slug = postSlugFromPath(url.pathname);
		if (!slug) {
			return errorJson("NOT_FOUND", "Post not found", 404);
		}

		const post = await posts.findPublishedBySlug(slug);
		if (!post) {
			return errorJson("NOT_FOUND", "Post not found", 404);
		}

		const markdown = await content.markdownForPost(post.id);
		if (markdown === null) {
			return errorJson("NOT_FOUND", "Post content not found", 404);
		}

		const response = postDetailResponse(post, markdown);
		if (!response) {
			return errorJson("NOT_FOUND", "Post not found", 404);
		}

		return json(response);
	}

	if (url.pathname === "/api/search") {
		const q = (url.searchParams.get("q") ?? "").trim();
		if (!q) {
			return json({ items: [], total: 0, q: "" });
		}

		const records = await posts.searchPublished(q);
		return json({
			items: records.map(toPublicSummary),
			total: records.length,
			q,
		});
	}

	return errorJson("NOT_FOUND", "Route not found", 404);
}
