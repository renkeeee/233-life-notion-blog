import { describe, expect, it } from "vitest";
import {
	decryptString,
	encryptString,
	generateEncryptionKey,
	hashPassword,
	passwordHashNeedsRehash,
	randomToken,
	sha256Hex,
	verifyPassword,
} from "../workers/crypto";

const textEncoder = new TextEncoder();
const fakeSha256Hex = "0".repeat(64);

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

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

function base64UrlToBytes(value: string): Uint8Array {
	const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
}

function testEncryptionKey(fill: number): string {
	return bytesToBase64Url(new Uint8Array(32).fill(fill));
}

async function pbkdf2Sha256Hash(
	password: string,
	salt: string,
	iterations: number,
): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		textEncoder.encode(password),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			salt: textEncoder.encode(salt),
			iterations,
		},
		key,
		256,
	);

	return bytesToHex(new Uint8Array(bits));
}

async function storedPasswordHash(
	password: string,
	salt: string,
	iterations: number,
): Promise<string> {
	const hash = await pbkdf2Sha256Hash(password, salt, iterations);

	return `pbkdf2-sha256:${iterations}:${salt}:${hash}`;
}

describe("crypto helpers", () => {
	it("creates stable SHA-256 hex hashes", async () => {
		expect(await sha256Hex("hello")).toBe(
			"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		);
	});

	it("creates random tokens with the requested byte length", () => {
		expect(randomToken(16)).toMatch(/^[0-9a-f]{32}$/);
	});

	it("rejects invalid random token byte lengths", () => {
		for (const bytes of [0, -1, 1.5]) {
			expect(() => randomToken(bytes)).toThrow(
				"Random token byte length must be a positive safe integer",
			);
		}
	});

	it("hashes and verifies passwords", async () => {
		const hash = await hashPassword("123456");
		expect(hash).not.toContain("123456");
		expect(await verifyPassword("123456", hash)).toBe(true);
		expect(await verifyPassword("bad", hash)).toBe(false);
	});

	it("verifies stored password hashes with valid non-default iteration counts", async () => {
		const stored = await storedPasswordHash("123456", "legacy-salt", 150_000);

		expect(await verifyPassword("123456", stored)).toBe(true);
		expect(await verifyPassword("bad", stored)).toBe(false);
	});

	it("rejects malformed and out-of-bounds password hash iterations", async () => {
		await expect(verifyPassword("123456", "bad")).resolves.toBe(false);
		await expect(
			verifyPassword(
				"123456",
				`pbkdf2-sha256:not-a-number:salt:${fakeSha256Hex}`,
			),
		).resolves.toBe(false);
		await expect(
			verifyPassword("123456", `pbkdf2-sha256:99999:salt:${fakeSha256Hex}`),
		).resolves.toBe(false);
		await expect(
			verifyPassword(
				"123456",
				`pbkdf2-sha256:1000001:salt:${fakeSha256Hex}`,
			),
		).resolves.toBe(false);
	});

	it("identifies password hashes that should be rehashed", async () => {
		const currentHash = await hashPassword("123456", "current-salt");
		const legacyHash = await storedPasswordHash(
			"123456",
			"legacy-salt",
			150_000,
		);

		expect(passwordHashNeedsRehash(currentHash)).toBe(false);
		expect(passwordHashNeedsRehash(legacyHash)).toBe(true);
		expect(
			passwordHashNeedsRehash(
				`pbkdf2-sha256:99999:salt:${fakeSha256Hex}`,
			),
		).toBe(true);
		expect(passwordHashNeedsRehash("bad")).toBe(true);
	});

	it("generates base64url 32-byte encryption keys", () => {
		const key = generateEncryptionKey();

		expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(base64UrlToBytes(key)).toHaveLength(32);
	});

	it("encrypts and decrypts config strings", async () => {
		const key = generateEncryptionKey();
		const encrypted = await encryptString("secret-value", key);

		expect(encrypted).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
		expect(encrypted).not.toContain("secret-value");
		expect(await decryptString(encrypted, key)).toBe("secret-value");
	});

	it("rejects short config encryption keys", async () => {
		await expect(encryptString("secret-value", "root-key")).rejects.toThrow(
			"32-byte",
		);
		await expect(decryptString("v1.abc.def", "root-key")).rejects.toThrow(
			"32-byte",
		);
	});

	it("fails to decrypt tampered ciphertext or with the wrong key", async () => {
		const key = testEncryptionKey(1);
		const wrongKey = testEncryptionKey(2);
		const encrypted = await encryptString("secret-value", key);
		const parts = encrypted.split(".");
		const tamperedCiphertext = `${parts[2].startsWith("A") ? "B" : "A"}${parts[2].slice(
			1,
		)}`;
		const tampered = `${parts[0]}.${parts[1]}.${tamperedCiphertext}`;

		await expect(decryptString(tampered, key)).rejects.toThrow();
		await expect(decryptString(encrypted, wrongKey)).rejects.toThrow();
	});
});
