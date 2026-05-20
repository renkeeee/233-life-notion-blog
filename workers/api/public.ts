import { PostsRepository, SettingsRepository } from "../db/d1";
import {
	checkCommentSubmissionRateLimit,
	commentRateLimitMessage,
	loadCommentsGlobalEnabled,
} from "../comments";
import { constantTimeEqual, decryptString, randomToken } from "../crypto";
import { errorJson, json, readJsonObject } from "../http";
import type { AppEnv, PublicPostRecord } from "../types";
import {
	handleTurnstileAccess,
	requireTurnstileAccess,
	verifyTurnstileToken,
} from "../turnstile";

type PublicPostSummary = {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	coverUrl: string | null;
	coverThumbnailUrl?: string;
	category: string | null;
	tags: string[];
	locked?: boolean;
	publishedAt: string | null;
	updatedAt: string;
};

type PublicPostComment = {
	id: string;
	nickname: string;
	body: string;
	createdAt: string;
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
const publicApiCacheControl = "public, no-cache";
const defaultFeedTitle = "233.life";
const defaultFeedDescription = "Life, written in quiet moments.";

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
		...(post.locked === true ? { locked: true } : {}),
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
	comments: PublicPostComment[] = [],
	options: { commentsGlobalEnabled?: boolean } = {},
) {
	if (!isPublished(post)) {
		return null;
	}

	const commentsGlobalEnabled = options.commentsGlobalEnabled !== false;

	return {
		...toPublicSummary(post),
		commentsEnabled:
			post.locked === true
				? false
				: commentsGlobalEnabled && post.commentsEnabled === true,
		comments,
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

function commentsSlugFromPath(pathname: string): string | null {
	const suffix = "/comments";

	if (!pathname.endsWith(suffix)) {
		return null;
	}

	return postSlugFromPath(pathname.slice(0, -suffix.length));
}

function stringFromBody(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	return typeof value === "string" ? value.trim() : "";
}

async function handleCreateComment(
	request: Request,
	env: AppEnv,
	posts: PostsRepository,
	slug: string,
): Promise<Response> {
	let body: Record<string, unknown>;
	try {
		body = await readJsonObject(request);
	} catch {
		return errorJson("BAD_REQUEST", "Invalid request body", 400);
	}

	const content = stringFromBody(body, "body");
	const nickname = stringFromBody(body, "nickname") || "Anonymous";
	const turnstileToken = stringFromBody(body, "turnstileToken");

	if (content.length === 0) {
		return errorJson("BAD_REQUEST", "Comment content is required", 400);
	}

	if (content.length > 2000 || nickname.length > 80) {
		return errorJson("BAD_REQUEST", "Comment is too long", 400);
	}

	const post = await posts.findPublishedBySlug(slug);
	if (!post) {
		return errorJson("NOT_FOUND", "Post not found", 404);
	}

	if (!(await loadCommentsGlobalEnabled(env.DB))) {
		return errorJson("FORBIDDEN", "Comments are disabled for this site", 403);
	}

	if (post.commentsEnabled !== true) {
		return errorJson("FORBIDDEN", "Comments are disabled for this post", 403);
	}

	if (!(await verifyTurnstileToken(turnstileToken, request, env))) {
		return errorJson("FORBIDDEN", "Turnstile verification failed", 403);
	}

	const rateLimit = await checkCommentSubmissionRateLimit(env.DB, {
		body: content,
		nickname,
		postId: post.id,
		request,
		rootKey: env.CONFIG_ENCRYPTION_KEY,
	});

	if (!rateLimit.allowed) {
		return json(
			{
				error: {
					code: "RATE_LIMITED",
					message: commentRateLimitMessage,
				},
			},
			429,
			{ "retry-after": String(rateLimit.retryAfterSeconds) },
		);
	}

	const comment = await posts.createComment({
		id: randomToken(12),
		postId: post.id,
		nickname,
		body: content,
		now: new Date().toISOString(),
	});

	return json({ comment });
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

function rssDate(value: string | null | undefined): string | null {
	if (!value) {
		return null;
	}

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return null;
	}

	return date.toUTCString();
}

function uniqueCategories(post: PublicPostRecord): string[] {
	const values = [post.category ?? "", ...(post.tags ?? [])]
		.map((value) => value.trim())
		.filter(Boolean);

	return Array.from(new Set(values));
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

type RssXmlOptions = {
	siteTitle?: string;
	description?: string;
	feedPath?: string;
};

export function rssXmlResponse(
	posts: PublicPostRecord[],
	origin: string,
	options: RssXmlOptions = {},
): string {
	const siteOrigin = normalizedOrigin(origin);
	const feedPath = options.feedPath ?? "/rss.xml";
	const channelTitle = options.siteTitle?.trim() || defaultFeedTitle;
	const channelDescription =
		options.description?.trim() || defaultFeedDescription;
	const lastBuildDate =
		rssDate(posts[0]?.updatedAt ?? posts[0]?.publishedAt) ??
		rssDate(new Date().toISOString());
	const items = posts.map((post) => {
		const postUrl = publicPostUrl(siteOrigin, post.slug);
		const pubDate = rssDate(post.publishedAt ?? post.updatedAt);
		const categories = uniqueCategories(post).map(
			(category) => `\t\t<category>${xmlEscape(category)}</category>`,
		);

		return [
			"\t<item>",
			`\t\t<title>${xmlEscape(post.title)}</title>`,
			`\t\t<link>${xmlEscape(postUrl)}</link>`,
			`\t\t<guid isPermaLink="true">${xmlEscape(postUrl)}</guid>`,
			post.excerpt.trim()
				? `\t\t<description>${xmlEscape(post.excerpt.trim())}</description>`
				: null,
			pubDate ? `\t\t<pubDate>${xmlEscape(pubDate)}</pubDate>` : null,
			...categories,
			"\t</item>",
		]
			.filter((line): line is string => line !== null)
			.join("\n");
	});

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
		"<channel>",
		`\t<title>${xmlEscape(channelTitle)}</title>`,
		`\t<link>${xmlEscape(`${siteOrigin}/`)}</link>`,
		`\t<description>${xmlEscape(channelDescription)}</description>`,
		`\t<atom:link href="${xmlEscape(`${siteOrigin}${feedPath}`)}" rel="self" type="application/rss+xml" />`,
		lastBuildDate
			? `\t<lastBuildDate>${xmlEscape(lastBuildDate)}</lastBuildDate>`
			: null,
		"\t<language>en</language>",
		...items,
		"</channel>",
		"</rss>",
		"",
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}

async function publicSiteTitle(env: AppEnv): Promise<string> {
	try {
		const row = await new SettingsRepository(env.DB).get("siteTitle");
		if (row && row.encrypted === 0 && row.value.trim()) {
			return row.value.trim();
		}
	} catch {
		// Feed generation should still work before settings are initialized.
	}

	return defaultFeedTitle;
}

export async function handleRss(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Not found", { status: 404 });
	}

	const repository = new PostsRepository(env.DB);
	const posts = await repository.listPublishedForFeed();
	const xml = rssXmlResponse(posts, new URL(request.url).origin, {
		siteTitle: await publicSiteTitle(env),
		feedPath: "/rss.xml",
	});

	return new Response(request.method === "HEAD" ? null : xml, {
		headers: {
			"content-type": "application/rss+xml; charset=utf-8",
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

	if (url.pathname === "/api/turnstile/access") {
		return handleTurnstileAccess(request, env);
	}

	const commentSlug =
		request.method === "POST" ? commentsSlugFromPath(url.pathname) : null;
	if (!commentSlug) {
		const turnstileAccessError = await requireTurnstileAccess(request, env);
		if (turnstileAccessError) {
			return turnstileAccessError;
		}
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
			publicApiCacheControl,
		);
	}

	if (url.pathname === "/api/tags") {
		return cacheableJson(
			request,
			{ items: await posts.listTags() },
			publicApiCacheControl,
		);
	}

	if (url.pathname === "/api/categories") {
		return cacheableJson(
			request,
			{ items: await posts.listCategories() },
			publicApiCacheControl,
		);
	}

	if (url.pathname.startsWith("/api/posts/")) {
		if (request.method === "POST") {
			if (commentSlug) {
				return handleCreateComment(request, env, posts, commentSlug);
			}

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

			return json(
				postDetailResponse(
					detail.post,
					detail.markdown,
					await posts.commentsForPost(detail.post.id),
					{
						commentsGlobalEnabled: await loadCommentsGlobalEnabled(env.DB),
					},
				),
			);
		}

		const slug = postSlugFromPath(url.pathname);
		if (!slug) {
			return errorJson("NOT_FOUND", "Post not found", 404);
		}

		const detail = await posts.findPublishedDetailBySlug(slug);
		if (detail) {
			return cacheableJson(
				request,
				postDetailResponse(
					detail.post,
					detail.markdown,
					await posts.commentsForPost(detail.post.id),
					{
						commentsGlobalEnabled: await loadCommentsGlobalEnabled(env.DB),
					},
				),
				publicApiCacheControl,
			);
		}

		const locked = await posts.findLockedBySlug(slug);
		if (locked) {
			return cacheableJson(
				request,
				{ locked: true, slug: locked.slug, title: locked.title },
				publicApiCacheControl,
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
				publicApiCacheControl,
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
			publicApiCacheControl,
		);
	}

	return errorJson("NOT_FOUND", "Route not found", 404);
}
