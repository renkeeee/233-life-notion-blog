import { describe, expect, it } from "vitest";
import { generateEncryptionKey } from "../workers/crypto";
import { createSessionToken, verifySessionToken } from "../workers/auth";

const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;
const textEncoder = new TextEncoder();

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
	const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
}

async function hmacSha256Base64Url(
	rootKey: string,
	input: string,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		base64UrlToBytes(rootKey),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		textEncoder.encode(input),
	);

	return bytesToBase64Url(new Uint8Array(signature));
}

async function signedToken(
	rootKey: string,
	payload: Record<string, unknown>,
	version = "v1",
): Promise<string> {
	const encodedPayload = bytesToBase64Url(
		textEncoder.encode(JSON.stringify(payload)),
	);
	const signature = await hmacSha256Base64Url(
		rootKey,
		`${version}.${encodedPayload}`,
	);

	return `${version}.${encodedPayload}.${signature}`;
}

function flipFirstBase64UrlCharacter(value: string): string {
	return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

describe("auth session tokens", () => {
	it("creates and verifies signed session tokens", async () => {
		const rootKey = generateEncryptionKey();
		const token = await createSessionToken(rootKey, "csrf-token");
		const session = await verifySessionToken(token, rootKey);

		expect(session.csrfToken).toBe("csrf-token");
		expect(session.expiresAt).toBeGreaterThan(Date.now());
	});

	it("binds the token version into the session signature", async () => {
		const rootKey = generateEncryptionKey();
		const token = await createSessionToken(rootKey, "csrf-token");
		const [version, payload, signature] = token.split(".");

		await expect(
			hmacSha256Base64Url(rootKey, `${version}.${payload}`),
		).resolves.toBe(signature);
	});

	it("rejects tokens signed with a different key", async () => {
		const token = await createSessionToken(
			generateEncryptionKey(),
			"csrf-token",
		);

		await expect(verifySessionToken(token, generateEncryptionKey())).rejects.toThrow(
			"Invalid session",
		);
	});

	it("rejects expired tokens", async () => {
		const rootKey = generateEncryptionKey();
		const now = Date.now();
		const token = await createSessionToken(rootKey, "csrf-token", now);

		await expect(
			verifySessionToken(token, rootKey, now + sessionTtlMs + 1),
		).rejects.toThrow("Invalid session");
	});

	it("rejects malformed tokens", async () => {
		await expect(
			verifySessionToken("not-a-session-token", generateEncryptionKey()),
		).rejects.toThrow("Invalid session");
	});

	it("rejects tokens with the wrong version", async () => {
		const rootKey = generateEncryptionKey();
		const token = await createSessionToken(rootKey, "csrf-token");

		await expect(
			verifySessionToken(token.replace(/^v1\./, "v2."), rootKey),
		).rejects.toThrow("Invalid session");
	});

	it("rejects tokens with tampered payloads", async () => {
		const rootKey = generateEncryptionKey();
		const now = Date.now();
		const token = await createSessionToken(rootKey, "csrf-token", now);
		const [version, , signature] = token.split(".");
		const tamperedPayload = bytesToBase64Url(
			textEncoder.encode(
				JSON.stringify({
					csrfToken: "other-csrf-token",
					expiresAt: now + sessionTtlMs,
				}),
			),
		);

		await expect(
			verifySessionToken(`${version}.${tamperedPayload}.${signature}`, rootKey),
		).rejects.toThrow("Invalid session");
	});

	it("rejects tokens with tampered signatures", async () => {
		const rootKey = generateEncryptionKey();
		const token = await createSessionToken(rootKey, "csrf-token");
		const [version, payload, signature] = token.split(".");

		await expect(
			verifySessionToken(
				`${version}.${payload}.${flipFirstBase64UrlCharacter(signature)}`,
				rootKey,
			),
		).rejects.toThrow("Invalid session");
	});

	it("rejects tokens with invalid expiry types", async () => {
		const rootKey = generateEncryptionKey();

		await expect(
			verifySessionToken(
				await signedToken(rootKey, {
					csrfToken: "csrf-token",
					expiresAt: "not-a-number",
				}),
				rootKey,
			),
		).rejects.toThrow("Invalid session");
	});

	it("rejects empty CSRF tokens", async () => {
		await expect(createSessionToken(generateEncryptionKey(), "")).rejects.toThrow(
			"Invalid session",
		);
	});

	it("rejects tokens with expiry beyond the maximum session TTL", async () => {
		const rootKey = generateEncryptionKey();
		const now = Date.now();

		await expect(
			verifySessionToken(
				await signedToken(rootKey, {
					csrfToken: "csrf-token",
					expiresAt: now + sessionTtlMs + 1,
				}),
				rootKey,
				now,
			),
		).rejects.toThrow("Invalid session");
	});
});
