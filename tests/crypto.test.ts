import { describe, expect, it } from "vitest";
import {
	decryptString,
	encryptString,
	hashPassword,
	sha256Hex,
	verifyPassword,
} from "../workers/crypto";

describe("crypto helpers", () => {
	it("creates stable SHA-256 hex hashes", async () => {
		expect(await sha256Hex("hello")).toBe(
			"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		);
	});

	it("hashes and verifies passwords", async () => {
		const hash = await hashPassword("123456");
		expect(hash).not.toContain("123456");
		expect(await verifyPassword("123456", hash)).toBe(true);
		expect(await verifyPassword("bad", hash)).toBe(false);
	});

	it("encrypts and decrypts config strings", async () => {
		const encrypted = await encryptString("secret-value", "root-key");
		expect(encrypted).not.toContain("secret-value");
		expect(await decryptString(encrypted, "root-key")).toBe("secret-value");
	});
});
