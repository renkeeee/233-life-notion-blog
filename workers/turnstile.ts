import { parseCookies, serializeCookie } from "./cookies";
import { decryptString, encryptString } from "./crypto";
import { errorJson, json, readJsonObject } from "./http";
import type { AppEnv } from "./types";

const accessCookieName = "turnstile_access";
const accessCookieMaxAgeSeconds = 60 * 60 * 24;
const siteverifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type AccessCookie = {
	expiresAt: number;
};

type SiteverifyResponse = {
	success?: boolean;
	"error-codes"?: string[];
};

export function turnstileConfigured(env: AppEnv): boolean {
	return Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}

function turnstileSiteKey(env: AppEnv): string {
	return env.TURNSTILE_SITE_KEY ?? "";
}

function remoteIp(request: Request): string | undefined {
	return (
		request.headers.get("cf-connecting-ip") ??
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		undefined
	);
}

function accessCookie(value: string): string {
	return serializeCookie(accessCookieName, value, {
		httpOnly: true,
		maxAge: accessCookieMaxAgeSeconds,
		path: "/",
		sameSite: "Lax",
		secure: true,
	});
}

async function createAccessToken(env: AppEnv, now = Date.now()): Promise<string> {
	const payload: AccessCookie = {
		expiresAt: now + accessCookieMaxAgeSeconds * 1000,
	};

	return encryptString(JSON.stringify(payload), env.CONFIG_ENCRYPTION_KEY);
}

async function hasAccessCookie(request: Request, env: AppEnv): Promise<boolean> {
	if (!turnstileConfigured(env)) {
		return true;
	}

	const token = parseCookies(request.headers.get("cookie"))[accessCookieName];
	if (!token) {
		return false;
	}

	try {
		const parsed = JSON.parse(
			await decryptString(token, env.CONFIG_ENCRYPTION_KEY),
		) as Partial<AccessCookie>;

		return (
			typeof parsed.expiresAt === "number" &&
			Number.isSafeInteger(parsed.expiresAt) &&
			parsed.expiresAt > Date.now()
		);
	} catch {
		return false;
	}
}

export async function requireTurnstileAccess(
	request: Request,
	env: AppEnv,
): Promise<Response | null> {
	if (await hasAccessCookie(request, env)) {
		return null;
	}

	return errorJson("FORBIDDEN", "Turnstile verification required", 403);
}

export async function verifyTurnstileToken(
	token: string,
	request: Request,
	env: AppEnv,
): Promise<boolean> {
	if (!turnstileConfigured(env)) {
		return true;
	}

	const trimmed = token.trim();
	if (!trimmed || trimmed.length > 2048) {
		return false;
	}

	try {
		const response = await fetch(env.TURNSTILE_SITEVERIFY_URL ?? siteverifyUrl, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				secret: env.TURNSTILE_SECRET_KEY,
				response: trimmed,
				remoteip: remoteIp(request),
			}),
		});
		const result = (await response.json()) as SiteverifyResponse;

		return result.success === true;
	} catch {
		return false;
	}
}

function accessStatusBody(verified: boolean, env: AppEnv) {
	return {
		enabled: turnstileConfigured(env),
		verified,
		siteKey: turnstileSiteKey(env),
	};
}

export async function handleTurnstileAccess(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	if (request.method === "GET") {
		return json(accessStatusBody(await hasAccessCookie(request, env), env));
	}

	if (request.method !== "POST") {
		return errorJson("NOT_FOUND", "Route not found", 404);
	}

	let token = "";
	try {
		const body = await readJsonObject(request);
		token = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
	} catch {
		token = "";
	}

	if (!(await verifyTurnstileToken(token, request, env))) {
		return errorJson("FORBIDDEN", "Turnstile verification failed", 403);
	}

	const response = json(accessStatusBody(true, env));
	response.headers.append(
		"set-cookie",
		accessCookie(await createAccessToken(env)),
	);
	return response;
}
