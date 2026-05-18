import type { ApiErrorBody, ApiErrorCode } from "./types";

type JsonResponseInit = number | ResponseInit;

function normalizeInit(
	init: JsonResponseInit,
	headers?: HeadersInit,
): ResponseInit {
	if (typeof init === "number") {
		return { status: init, headers };
	}

	return init;
}

export function json<T>(body: T, status?: number, headers?: HeadersInit): Response;
export function json<T>(body: T, init?: ResponseInit): Response;
export function json<T>(
	body: T,
	init: JsonResponseInit = 200,
	headers?: HeadersInit,
): Response {
	const responseInit = normalizeInit(init, headers);
	const responseHeaders = new Headers(responseInit.headers);
	responseHeaders.set("content-type", "application/json; charset=utf-8");

	return new Response(JSON.stringify(body), {
		...responseInit,
		headers: responseHeaders,
	});
}

export function errorJson(
	code: ApiErrorCode,
	message: string,
	status: number,
): Response {
	return json<ApiErrorBody>({ error: { code, message } }, status);
}

export async function readJsonObject(
	request: Request,
): Promise<Record<string, unknown>> {
	const body = await request.json().catch(() => null);

	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new Error("Expected JSON object body");
	}

	return body as Record<string, unknown>;
}
