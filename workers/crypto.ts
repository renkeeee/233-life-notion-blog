const passwordHashIterations = 210_000;
const passwordHashAlgorithm = "pbkdf2-sha256";
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";

	for (let index = 0; index < bytes.length; index += 1) {
		binary += String.fromCharCode(bytes[index]);
	}

	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);

	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes;
}

function constantTimeEqual(left: string, right: string): boolean {
	const maxLength = Math.max(left.length, right.length);
	let diff = left.length ^ right.length;

	for (let index = 0; index < maxLength; index += 1) {
		diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
	}

	return diff === 0;
}

async function derivePasswordHashHex(
	password: string,
	salt: string,
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
			iterations: passwordHashIterations,
		},
		key,
		256,
	);

	return bytesToHex(new Uint8Array(bits));
}

async function encryptionKey(rootKey: string): Promise<CryptoKey> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		textEncoder.encode(rootKey),
	);

	return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
		"encrypt",
		"decrypt",
	]);
}

export async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
	const data = typeof input === "string" ? textEncoder.encode(input) : input;
	const digest = await crypto.subtle.digest("SHA-256", data);

	return bytesToHex(new Uint8Array(digest));
}

export function randomToken(bytes = 32): string {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);

	return bytesToHex(buffer);
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
	const parts = stored.split(":");

	if (parts.length !== 4) {
		return false;
	}

	const [algorithm, iterations, salt, expectedHash] = parts;

	if (
		algorithm !== passwordHashAlgorithm ||
		iterations !== String(passwordHashIterations) ||
		!salt ||
		!expectedHash
	) {
		return false;
	}

	const actualHash = await derivePasswordHashHex(password, salt);

	return constantTimeEqual(actualHash, expectedHash);
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

	return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptString(
	cipherText: string,
	rootKey: string,
): Promise<string> {
	const parts = cipherText.split(".");

	if (parts.length !== 2 || !parts[0] || !parts[1]) {
		throw new Error("Invalid encrypted value");
	}

	const [ivBase64, dataBase64] = parts;
	const decrypted = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: base64ToBytes(ivBase64) },
		await encryptionKey(rootKey),
		base64ToBytes(dataBase64),
	);

	return textDecoder.decode(decrypted);
}
