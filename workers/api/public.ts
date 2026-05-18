import { PostContentRepository, PostsRepository } from "../db/d1";
import { errorJson, json } from "../http";
import type { AppEnv, PublicPostRecord } from "../types";

type PublicPostSummary = {
	id: string;
	slug: string;
	title: string;
	coverUrl: string | null;
	publishedAt: string | null;
	updatedAt: string;
};

type ListOptions = {
	page?: number;
	limit?: number;
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
		coverUrl: post.coverUrl,
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
		const result = await posts.listPublished({
			...pagination,
			q: query || undefined,
		});

		return json(listPostsResponse(result, pagination));
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
