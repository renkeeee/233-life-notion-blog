import { errorJson, json, readJsonObject } from "../http";
import type { AppEnv } from "../types";

type LoginBody = {
	password: string;
};

export function validateLoginBody(body: Record<string, unknown>): LoginBody {
	if (typeof body.password !== "string" || body.password.length === 0) {
		throw new Error("Password is required");
	}

	return { password: body.password };
}

function adminNotFound(): Response {
	return errorJson("NOT_FOUND", "Admin API route not found", 404);
}

export async function handleAdminApi(
	request: Request,
	_env: AppEnv,
): Promise<Response> {
	const url = new URL(request.url);

	if (url.pathname === "/api/admin/login" && request.method === "POST") {
		let body: Record<string, unknown>;
		try {
			body = await readJsonObject(request);
			validateLoginBody(body);
		} catch (error) {
			const message =
				error instanceof Error && error.message === "Password is required"
					? error.message
					: "Invalid request body";
			return errorJson("BAD_REQUEST", message, 400);
		}

		return json({ ok: true });
	}

	if (url.pathname === "/api/admin/me" && request.method === "GET") {
		return json({ authenticated: false });
	}

	return adminNotFound();
}
