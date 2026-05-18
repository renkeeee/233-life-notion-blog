export interface CookieOptions {
	httpOnly?: boolean;
	maxAge?: number;
	path?: string;
	sameSite?: "Lax" | "Strict" | "None";
	secure?: boolean;
}

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

export function serializeCookie(
	name: string,
	value: string,
	options: CookieOptions = {},
): string {
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
