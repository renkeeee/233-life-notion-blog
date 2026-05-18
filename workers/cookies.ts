export interface CookieOptions {
	httpOnly?: boolean;
	maxAge?: number;
	path?: string;
	sameSite?: "Lax" | "Strict" | "None";
	secure?: boolean;
}

const cookieNamePattern = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const controlCharacterPattern = /[\u0000-\u001F\u007F]/;
const sameSiteValues = new Set(["Lax", "Strict", "None"]);

function decodeCookieValue(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function parseCookies(header: string | null): Record<string, string> {
	if (!header) {
		return {};
	}

	const cookies: Record<string, string> = {};

	for (const fragment of header.split(";")) {
		const trimmed = fragment.trim();

		if (!trimmed) {
			continue;
		}

		const equalsIndex = trimmed.indexOf("=");
		const name =
			equalsIndex === -1 ? trimmed : trimmed.slice(0, equalsIndex).trim();

		if (!name) {
			continue;
		}

		const value = equalsIndex === -1 ? "" : trimmed.slice(equalsIndex + 1);
		cookies[name] = decodeCookieValue(value);
	}

	return cookies;
}

function assertCookieName(name: string): void {
	if (!cookieNamePattern.test(name)) {
		throw new Error("Invalid cookie name");
	}
}

function assertCookieValue(value: string): void {
	if (controlCharacterPattern.test(value) || value.includes(";")) {
		throw new Error("Invalid cookie value");
	}
}

function assertCookiePath(path: string): void {
	if (controlCharacterPattern.test(path) || path.includes(";")) {
		throw new Error("Invalid cookie path");
	}
}

function assertCookieSameSite(sameSite: CookieOptions["sameSite"]): void {
	if (sameSite !== undefined && !sameSiteValues.has(sameSite)) {
		throw new Error("Invalid cookie SameSite");
	}
}

export function serializeCookie(
	name: string,
	value: string,
	options: CookieOptions = {},
): string {
	assertCookieName(name);
	assertCookieValue(value);

	if (options.path) {
		assertCookiePath(options.path);
	}

	if (
		options.maxAge !== undefined &&
		(!Number.isFinite(options.maxAge) || !Number.isInteger(options.maxAge))
	) {
		throw new Error("Invalid cookie Max-Age");
	}

	assertCookieSameSite(options.sameSite);

	if (options.sameSite === "None" && !options.secure) {
		throw new Error("SameSite=None cookies must be Secure");
	}

	const parts = [`${name}=${encodeURIComponent(value)}`];

	if (options.maxAge !== undefined) {
		parts.push(`Max-Age=${options.maxAge}`);
	}

	if (options.path) {
		parts.push(`Path=${options.path}`);
	}

	if (options.sameSite) {
		parts.push(`SameSite=${options.sameSite}`);
	}

	if (options.httpOnly) {
		parts.push("HttpOnly");
	}

	if (options.secure) {
		parts.push("Secure");
	}

	return parts.join("; ");
}
