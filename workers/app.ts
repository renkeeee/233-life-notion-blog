function json(data: unknown, init?: ResponseInit) {
	return Response.json(data, {
		...init,
		headers: {
			"content-type": "application/json",
			...init?.headers,
		},
	});
}

export default {
	fetch(request) {
		const url = new URL(request.url);

		if (url.pathname === "/api/health") {
			return json({ ok: true });
		}

		if (url.pathname.startsWith("/api/")) {
			return json({ error: "Not found" }, { status: 404 });
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
