import { sha256Hex } from "./crypto";

export interface AssetHttpMetadata {
	contentType?: string;
	cacheControl?: string;
	contentDisposition?: string;
	contentEncoding?: string;
	contentLanguage?: string;
}

export type AssetBody =
	| ArrayBuffer
	| ArrayBufferView
	| Blob
	| ReadableStream
	| string;

export interface AssetBucket {
	head(key: string): Promise<unknown | null>;
	put(
		key: string,
		body: AssetBody,
		options?: { httpMetadata?: AssetHttpMetadata },
	): Promise<unknown>;
}

const mimeExtensions = new Map<string, string>([
	["image/png", ".png"],
	["image/jpeg", ".jpg"],
	["image/jpg", ".jpg"],
	["image/gif", ".gif"],
	["image/webp", ".webp"],
	["image/svg+xml", ".svg"],
	["application/pdf", ".pdf"],
	["video/mp4", ".mp4"],
	["audio/mpeg", ".mp3"],
	["audio/mp3", ".mp3"],
]);

export function buildAssetKey(contentHash: string, mimeType: string): string {
	if (!/^[0-9a-f]{64}$/.test(contentHash)) {
		throw new Error("Invalid asset content hash");
	}

	const normalizedMimeType = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
	const extension = mimeExtensions.get(normalizedMimeType) ?? ".bin";

	return `assets/${contentHash.slice(0, 2)}/${contentHash}${extension}`;
}

export function cdnUrlForKey(cdnBaseUrl: string, key: string): string {
	const normalizedBase = cdnBaseUrl.replace(/\/+$/, "");
	const normalizedKey = key.replace(/^\/+/, "");

	return `${normalizedBase}/${normalizedKey}`;
}

export async function contentHashForBytes(
	bytes: ArrayBuffer | ArrayBufferView,
): Promise<string> {
	if (!ArrayBuffer.isView(bytes)) {
		return sha256Hex(bytes);
	}

	const view = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const copy = new Uint8Array(view);

	return sha256Hex(copy.buffer);
}

export async function uploadAssetIfMissing(
	bucket: AssetBucket,
	key: string,
	body: AssetBody,
	httpMetadata?: AssetHttpMetadata,
): Promise<boolean> {
	const existing = await bucket.head(key);
	if (existing) {
		return false;
	}

	await bucket.put(key, body, { httpMetadata });

	return true;
}
