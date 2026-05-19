const passwordHashIterations = 100_000;
const passwordHashMaxIterations = 100_000;
const passwordHashMinIterations = 100_000;
const passwordHashAlgorithm = "pbkdf2-sha256";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

interface ParsedPasswordHash {
	hash: string;
	iterations: number;
	salt: string;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";

	for (let index = 0; index < bytes.length; index += 1) {
		binary += String.fromCharCode(bytes[index]);
	}

	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
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

export function constantTimeEqual(left: string, right: string): boolean {
	const maxLength = Math.max(left.length, right.length);
	let diff = left.length ^ right.length;

	for (let index = 0; index < maxLength; index += 1) {
		diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
	}

	return diff === 0;
}

function parsePasswordHash(stored: string): ParsedPasswordHash | null {
	const parts = stored.split(":");

	if (parts.length !== 4) {
		return null;
	}

	const [algorithm, iterationsValue, salt, hash] = parts;

	if (
		algorithm !== passwordHashAlgorithm ||
		!/^[1-9]\d*$/.test(iterationsValue) ||
		!salt ||
		!/^[0-9a-fA-F]{64}$/.test(hash)
	) {
		return null;
	}

	const iterations = Number(iterationsValue);

	if (
		!Number.isSafeInteger(iterations) ||
		iterations < passwordHashMinIterations ||
		iterations > passwordHashMaxIterations
	) {
		return null;
	}

	return { hash: hash.toLowerCase(), iterations, salt };
}

async function derivePasswordHashHex(
	password: string,
	salt: string,
	iterations = passwordHashIterations,
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

function encryptionKeyBytes(rootKey: string): Uint8Array<ArrayBuffer> {
	try {
		const bytes = base64UrlToBytes(rootKey);

		if (bytes.length === 32) {
			return bytes;
		}
	} catch {
		// Normalize all key parsing failures to a single public error.
	}

	throw new Error(
		"Encryption root key must be a base64url-encoded 32-byte key",
	);
}

async function encryptionKey(rootKey: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		"raw",
		encryptionKeyBytes(rootKey),
		"AES-GCM",
		false,
		["encrypt", "decrypt"],
	);
}

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
	const data = typeof input === "string" ? textEncoder.encode(input) : input;
	const digest = await crypto.subtle.digest("SHA-256", data);

	return bytesToHex(new Uint8Array(digest));
}

export function randomToken(bytes = 32): string {
	if (!Number.isSafeInteger(bytes) || bytes <= 0) {
		throw new Error("Random token byte length must be a positive safe integer");
	}

	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);

	return bytesToHex(buffer);
}

export function generateEncryptionKey(): string {
	const buffer = new Uint8Array(32);
	crypto.getRandomValues(buffer);

	return bytesToBase64Url(buffer);
}

export async function hashPassword(
	password: string,
	salt = randomToken(16),
): Promise<string> {
	const hash = await derivePasswordHashHex(password, salt);

	return `${passwordHashAlgorithm}:${passwordHashIterations}:${salt}:${hash}`;
}

export async function verifyPassword(
	password: string,
	stored: string,
): Promise<boolean> {
	const parsed = parsePasswordHash(stored);

	if (!parsed) {
		return false;
	}

	const actualHash = await derivePasswordHashHex(
		password,
		parsed.salt,
		parsed.iterations,
	);

	return constantTimeEqual(actualHash, parsed.hash);
}

export function passwordHashNeedsRehash(stored: string): boolean {
	const parsed = parsePasswordHash(stored);

	return !parsed || parsed.iterations !== passwordHashIterations;
}

export async function encryptString(
	plainText: string,
	rootKey: string,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await encryptionKey(rootKey),
		textEncoder.encode(plainText),
	);

	return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(
		new Uint8Array(encrypted),
	)}`;
}

export async function decryptString(
	cipherText: string,
	rootKey: string,
): Promise<string> {
	const key = await encryptionKey(rootKey);
	const parts = cipherText.split(".");

	if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) {
		throw new Error("Invalid encrypted value");
	}

	const [, ivBase64, dataBase64] = parts;
	const decrypted = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: base64UrlToBytes(ivBase64) },
		key,
		base64UrlToBytes(dataBase64),
	);

	return textDecoder.decode(decrypted);
}
