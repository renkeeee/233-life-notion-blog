import {
	base64UrlToBytes,
	bytesToBase64Url,
	constantTimeEqual,
	randomToken,
} from "./crypto";

export interface AdminSession {
	csrfToken: string;
	expiresAt: number;
}

export const initialAdminPassword = "123456";

const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function shouldBootstrapPassword(storedHash: string | null): boolean {
	return storedHash === null;
}

function rootKeyBytes(rootKey: string): Uint8Array<ArrayBuffer> {
	try {
		const bytes = base64UrlToBytes(rootKey);

		if (bytes.length === 32) {
			return bytes;
		}
	} catch {
		// Normalize key parsing failures to the public session error.
	}

	throw new Error("Invalid session");
}

async function signingKey(rootKey: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		rootKeyBytes(rootKey),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

async function signTokenParts(
	version: string,
	payload: string,
	rootKey: string,
): Promise<string> {
	const signature = await crypto.subtle.sign(
		"HMAC",
		await signingKey(rootKey),
		textEncoder.encode(`${version}.${payload}`),
	);

	return bytesToBase64Url(new Uint8Array(signature));
}

function parseSessionPayload(payload: string): AdminSession {
	const parsed = JSON.parse(textDecoder.decode(base64UrlToBytes(payload))) as {
		csrfToken?: unknown;
		expiresAt?: unknown;
	};

	if (
		typeof parsed.csrfToken !== "string" ||
		typeof parsed.expiresAt !== "number" ||
		!Number.isSafeInteger(parsed.expiresAt)
	) {
		throw new Error("Invalid session");
	}

	return {
		csrfToken: parsed.csrfToken,
		expiresAt: parsed.expiresAt,
	};
}

function validateSession(session: AdminSession, now: number): void {
	if (
		session.csrfToken.length === 0 ||
		!Number.isSafeInteger(session.expiresAt) ||
		session.expiresAt <= now ||
		session.expiresAt > now + sessionTtlMs
	) {
		throw new Error("Invalid session");
	}
}

export async function createSessionToken(
	rootKey: string,
	csrfToken = randomToken(24),
	now = Date.now(),
): Promise<string> {
	if (csrfToken.length === 0) {
		throw new Error("Invalid session");
	}

	const session = {
		csrfToken,
		expiresAt: now + sessionTtlMs,
	} satisfies AdminSession;
	validateSession(session, now);

	const payload = bytesToBase64Url(
		textEncoder.encode(JSON.stringify(session)),
	);

	return `v1.${payload}.${await signTokenParts("v1", payload, rootKey)}`;
}

export async function verifySessionToken(
	token: string,
	rootKey: string,
	now = Date.now(),
): Promise<AdminSession> {
	try {
		const parts = token.split(".");

		if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) {
			throw new Error("Invalid session");
		}

		const [, payload, signature] = parts;
		const expectedSignature = await signTokenParts("v1", payload, rootKey);

		if (!constantTimeEqual(signature, expectedSignature)) {
			throw new Error("Invalid session");
		}

		const session = parseSessionPayload(payload);
		validateSession(session, now);

		return session;
	} catch {
		throw new Error("Invalid session");
	}
}
