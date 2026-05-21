import { describe, expect, it } from "vitest";
import worker, { routeKind } from "../workers/app";
import type { AppEnv } from "../workers/types";

type WorkerRequest = Parameters<NonNullable<typeof worker.fetch>>[0];

const env: AppEnv = {
	DB: {} as D1Database,
	BLOG_ASSETS: {} as R2Bucket,
	CONFIG_ENCRYPTION_KEY: "test-encryption-key",
};

const indexHtml = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<meta name="description" content="A Notion-backed personal blog." />
		<title>233.life</title>
	</head>
	<body><div id="root"></div></body>
</html>`;

function envWithAssets(): AppEnv & {
	ASSETS: { fetch(request: Request): Promise<Response> };
} {
	return {
		...env,
		ASSETS: {
			async fetch() {
				return new Response(indexHtml, {
					headers: { "content-type": "text/html; charset=utf-8" },
				});
			},
		},
	};
}

function workerRequest(pathname: string): WorkerRequest {
	return new Request(`https://example.test${pathname}`) as WorkerRequest;
}

function insecureWorkerRequest(pathname: string): WorkerRequest {
	return new Request(`http://example.test${pathname}`) as WorkerRequest;
}

describe("worker route kind", () => {
	it.each(["/api", "/api/posts", "/api/admin/login"])(
		"routes %s as api",
		(pathname) => {
			expect(routeKind(workerRequest(pathname))).toBe("api");
		},
	);

	it("routes sitemap requests as sitemap", () => {
		expect(routeKind(workerRequest("/sitemap.xml"))).toBe("sitemap");
	});

	it.each(["/rss.xml", "/feed.xml"])("routes %s as rss", (pathname) => {
		expect(routeKind(workerRequest(pathname))).toBe("rss");
	});

	it("routes robots.txt requests as robots", () => {
		expect(routeKind(workerRequest("/robots.txt"))).toBe("robots");
	});

	it("routes non-api paths as app", () => {
		expect(routeKind(workerRequest("/posts/example"))).toBe("app");
	});
});

describe("worker API dispatch", () => {
	it("redirects production HTTP requests to HTTPS before routing", async () => {
		const response = await worker.fetch(
			insecureWorkerRequest("/api/health?probe=1"),
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(308);
		expect(response.headers.get("location")).toBe(
			"https://example.test/api/health?probe=1",
		);
	});

	it("does not redirect local HTTP requests during development", async () => {
		const response = await worker.fetch(
			new Request("http://127.0.0.1/api/health") as WorkerRequest,
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("dispatches admin me requests to the admin handler", async () => {
		const response = await worker.fetch(
			workerRequest("/api/admin/me"),
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ authenticated: false });
	});

	it("keeps public health API routing intact", async () => {
		const response = await worker.fetch(
			workerRequest("/api/health"),
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("x-robots-tag")).toBe(
			"noindex, nofollow, noarchive, nosnippet, noimageindex",
		);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("returns robots.txt without blocking public noindex reads", async () => {
		const response = await worker.fetch(
			workerRequest("/robots.txt"),
			env,
			{} as ExecutionContext,
		);
		const body = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/plain");
		expect(response.headers.get("x-robots-tag")).toBe(
			"noindex, nofollow, noarchive, nosnippet, noimageindex",
		);
		expect(body).toContain("User-agent: *");
		expect(body).toContain("Allow: /");
		expect(body).toContain("Disallow: /admin");
		expect(body.split("\n")).not.toContain("Disallow: /");
		expect(body).not.toContain("Sitemap:");
	});

	it("serves app HTML with noindex and sharing metadata", async () => {
		const response = await worker.fetch(
			workerRequest("/"),
			envWithAssets(),
			{} as ExecutionContext,
		);
		const html = await response.text();

		expect(response.status).toBe(200);
		expect(response.headers.get("x-robots-tag")).toBe(
			"noindex, nofollow, noarchive, nosnippet, noimageindex",
		);
		expect(html).toContain(
			'<meta name="robots" content="noindex,nofollow,noarchive,nosnippet,noimageindex" />',
		);
		expect(html).toContain('<meta property="og:title" content="233.life" />');
		expect(html).toContain(
			'<meta property="og:description" content="Life, written in quiet moments." />',
		);
		expect(html).toContain(
			'<meta property="og:url" content="https://example.test/" />',
		);
	});

	it("uses the admin 404 shape under /api/admin", async () => {
		const response = await worker.fetch(
			workerRequest("/api/admin/nope"),
			env,
			{} as ExecutionContext,
		);

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			error: { code: "NOT_FOUND", message: "Admin API route not found" },
		});
	});
});
