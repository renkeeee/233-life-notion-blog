import { PostContentRepository, PostsRepository } from "../db/d1";
import { errorJson, json } from "../http";
import type { AppEnv } from "../types";

export interface PublicPostRecord {
	id: string;
	slug: string;
	title: string;
	summary: string | null;
	coverUrl: string | null;
	tags: string[];
	status: string;
	visibility: string;
	publishedAt: string | null;
	updatedAt: string;
}

type PublicPostSummary = {
	id: string;
	slug: string;
	title: string;
	summary: string | null;
	coverUrl: string | null;
	tags: string[];
	publishedAt: string | null;
	updatedAt: string;
};

type ListOptions = {
	page?: number;
	limit?: number;
	tag?: string;
	q?: string;
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
		summary: post.summary,
		coverUrl: post.coverUrl,
		tags: post.tags,
		publishedAt: post.publishedAt,
		updatedAt: post.updatedAt,
	};
}

function matchesQuery(post: PublicPostRecord, q: string): boolean {
	const normalized = q.trim().toLowerCase();
	if (!normalized) {
		return true;
	}

	return [post.title, post.summary ?? "", ...post.tags]
		.join(" ")
		.toLowerCase()
		.includes(normalized);
}

export function listPostsResponse(
	posts: PublicPostRecord[],
	options: ListOptions = {},
) {
	const page = options.page ?? defaultPage;
	const limit = options.limit ?? defaultLimit;
	const tag = options.tag?.trim();
	const q = options.q?.trim() ?? "";
	const filtered = posts.filter((post) => {
		if (!isPublished(post)) {
			return false;
		}
		if (tag && !post.tags.includes(tag)) {
			return false;
		}

		return matchesQuery(post, q);
	});
	const start = (page - 1) * limit;
	const paginated = filtered.slice(start, start + limit);

	return {
		items: paginated.map(toPublicSummary),
		total: filtered.length,
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

		const query =
			url.searchParams.get("q") ?? url.searchParams.get("search") ?? "";
		const records = query.trim()
			? await posts.searchPublished(query.trim())
			: await posts.listPublished();

		return json(
			listPostsResponse(records, {
				...pagination,
				tag: url.searchParams.get("tag") ?? undefined,
			}),
		);
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

	if (url.pathname === "/api/tags") {
		return json({ items: await posts.tagCounts() });
	}

	if (url.pathname === "/api/search") {
		const q = (url.searchParams.get("q") ?? "").trim();
		if (!q) {
			return json({ items: [], total: 0, q: "" });
		}

		const records = await posts.searchPublished(q);
		return json({
			items: records.filter(isPublished).map(toPublicSummary),
			total: records.filter(isPublished).length,
			q,
		});
	}

	return errorJson("NOT_FOUND", "Route not found", 404);
}
