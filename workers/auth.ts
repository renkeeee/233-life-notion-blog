import { randomToken } from "./crypto";

export interface AdminSession {
	csrfToken: string;
	expiresAt: number;
}

const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";

	for (let index = 0; index < bytes.length; index += 1) {
		binary += String.fromCharCode(bytes[index]);
	}

	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
		throw new Error("Invalid base64url value");
	}

	const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
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

async function signPayload(payload: string, rootKey: string): Promise<string> {
	const signature = await crypto.subtle.sign(
		"HMAC",
		await signingKey(rootKey),
		textEncoder.encode(payload),
	);

	return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string): boolean {
	const maxLength = Math.max(left.length, right.length);
	let diff = left.length ^ right.length;

	for (let index = 0; index < maxLength; index += 1) {
		diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
	}

	return diff === 0;
}

function parseSessionPayload(payload: string): AdminSession {
	const parsed = JSON.parse(textDecoder.decode(base64UrlToBytes(payload))) as {
		csrfToken?: unknown;
		expiresAt?: unknown;
	};

	if (
		typeof parsed.csrfToken !== "string" ||
		typeof parsed.expiresAt !== "number" ||
		!Number.isFinite(parsed.expiresAt)
	) {
		throw new Error("Invalid session");
	}

	return {
		csrfToken: parsed.csrfToken,
		expiresAt: parsed.expiresAt,
	};
}

export async function createSessionToken(
	rootKey: string,
	csrfToken = randomToken(24),
	now = Date.now(),
): Promise<string> {
	const payload = bytesToBase64Url(
		textEncoder.encode(
			JSON.stringify({
				csrfToken,
				expiresAt: now + sessionTtlMs,
			} satisfies AdminSession),
		),
	);

	return `v1.${payload}.${await signPayload(payload, rootKey)}`;
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
		const expectedSignature = await signPayload(payload, rootKey);

		if (!constantTimeEqual(signature, expectedSignature)) {
			throw new Error("Invalid session");
		}

		const session = parseSessionPayload(payload);

		if (session.expiresAt <= now) {
			throw new Error("Invalid session");
		}

		return session;
	} catch {
		throw new Error("Invalid session");
	}
}
