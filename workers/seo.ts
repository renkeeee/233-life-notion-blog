import { PostsRepository } from "./db/d1";
import type { AppEnv } from "./types";

export const noIndexMetaContent =
	"noindex,nofollow,noarchive,nosnippet,noimageindex";
export const noIndexHeaderValue =
	"noindex, nofollow, noarchive, nosnippet, noimageindex";

const siteTitle = "233.life";
const siteDescription = "Life, written in quiet moments.";

type SeoMetadata = {
	title: string;
	description: string;
	url: string;
	type: "website" | "article";
	image?: string;
};

export function withNoIndexHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.set("x-robots-tag", noIndexHeaderValue);

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export function handleRobots(request: Request): Response {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Not found", { status: 404 });
	}

	const body = [
		"User-agent: *",
		"Allow: /",
		"Disallow: /admin",
		"Disallow: /api",
		"Disallow: /demo",
		"",
	].join("\n");

	return withNoIndexHeaders(
		new Response(request.method === "HEAD" ? null : body, {
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"cache-control": "public, max-age=300",
			},
		}),
	);
}

export async function handleAppRequest(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response("Not found", { status: 404 });
	}

	if (!env.ASSETS) {
		return new Response("Not found", { status: 404 });
	}

	const assetResponse = await env.ASSETS.fetch(request);
	const contentType = assetResponse.headers.get("content-type") ?? "";
	if (!contentType.includes("text/html")) {
		return withNoIndexHeaders(assetResponse);
	}

	const metadata = await metadataForRequest(request, env);
	const headers = new Headers(assetResponse.headers);
	headers.set("content-type", "text/html; charset=utf-8");

	if (request.method === "HEAD") {
		return withNoIndexHeaders(
			new Response(null, {
				status: assetResponse.status,
				statusText: assetResponse.statusText,
				headers,
			}),
		);
	}

	return withNoIndexHeaders(
		new Response(injectSeoMetadata(await assetResponse.text(), metadata), {
			status: assetResponse.status,
			statusText: assetResponse.statusText,
			headers,
		}),
	);
}

async function metadataForRequest(
	request: Request,
	env: AppEnv,
): Promise<SeoMetadata> {
	const url = new URL(request.url);
	const base: SeoMetadata = {
		title: siteTitle,
		description: siteDescription,
		url: canonicalUrl(url),
		type: "website",
	};

	if (url.pathname === "/archive") {
		return {
			...base,
			title: `Archive | ${siteTitle}`,
			description: "A quiet archive of posts from 233.life.",
		};
	}

	if (url.pathname === "/search") {
		return {
			...base,
			title: `Search | ${siteTitle}`,
			description: "Search posts on 233.life.",
		};
	}

	const slug = postSlugFromPath(url.pathname);
	if (!slug) {
		return base;
	}

	const posts = new PostsRepository(env.DB);
	const post = await posts.findPublishedBySlug(slug);
	if (post) {
		return {
			title: `${post.title} | ${siteTitle}`,
			description: conciseDescription(post.excerpt),
			url: canonicalUrl(url),
			type: "article",
			...(post.coverUrl ? { image: post.coverUrl } : {}),
		};
	}

	const locked = await posts.findLockedBySlug(slug);
	if (locked) {
		return {
			title: `${locked.title} | ${siteTitle}`,
			description: "This post is locked.",
			url: canonicalUrl(url),
			type: "article",
		};
	}

	return base;
}

function postSlugFromPath(pathname: string): string | null {
	const prefix = "/post/";
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

function canonicalUrl(url: URL): string {
	return `${url.origin}${url.pathname}`;
}

function conciseDescription(value: string): string {
	const normalized = value.trim().replace(/\s+/g, " ");
	if (!normalized) {
		return siteDescription;
	}

	return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function metaTag(name: string, content: string): string {
	return `<meta name="${name}" content="${escapeHtml(content)}" />`;
}

function propertyTag(property: string, content: string): string {
	return `<meta property="${property}" content="${escapeHtml(content)}" />`;
}

export function injectSeoMetadata(html: string, metadata: SeoMetadata): string {
	const cleaned = html
		.replace(/<title>[\s\S]*?<\/title>\s*/i, "")
		.replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, "")
		.replace(/<meta\s+name=["']robots["'][^>]*>\s*/gi, "")
		.replace(/<meta\s+name=["']googlebot["'][^>]*>\s*/gi, "")
		.replace(/<meta\s+(?:property|name)=["'](?:og|twitter):[^"']+["'][^>]*>\s*/gi, "")
		.replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, "");
	const tags = [
		`<title>${escapeHtml(metadata.title)}</title>`,
		metaTag("description", metadata.description),
		metaTag("robots", noIndexMetaContent),
		metaTag("googlebot", noIndexMetaContent),
		`<link rel="canonical" href="${escapeHtml(metadata.url)}" />`,
		propertyTag("og:site_name", siteTitle),
		propertyTag("og:type", metadata.type),
		propertyTag("og:title", metadata.title),
		propertyTag("og:description", metadata.description),
		propertyTag("og:url", metadata.url),
		metaTag("twitter:card", metadata.image ? "summary_large_image" : "summary"),
		metaTag("twitter:title", metadata.title),
		metaTag("twitter:description", metadata.description),
		...(metadata.image
			? [
					propertyTag("og:image", metadata.image),
					metaTag("twitter:image", metadata.image),
				]
			: []),
	];

	return cleaned.replace("</head>", `\t\t${tags.join("\n\t\t")}\n\t</head>`);
}
