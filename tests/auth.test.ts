import { describe, expect, it } from "vitest";
import { generateEncryptionKey } from "../workers/crypto";
import { createSessionToken, verifySessionToken } from "../workers/auth";

const sessionTtlMs = 1000 * 60 * 60 * 24 * 7;

describe("auth session tokens", () => {
	it("creates and verifies signed session tokens", async () => {
		const rootKey = generateEncryptionKey();
		const token = await createSessionToken(rootKey, "csrf-token");
		const session = await verifySessionToken(token, rootKey);

		expect(session.csrfToken).toBe("csrf-token");
		expect(session.expiresAt).toBeGreaterThan(Date.now());
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
});
