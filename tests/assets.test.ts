import { describe, expect, it, vi } from "vitest";
import {
	buildAssetKey,
	cdnUrlForKey,
	contentHashForBytes,
	uploadAssetIfMissing,
	type AssetBucket,
} from "../workers/assets";

const validHash =
	"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("buildAssetKey", () => {
	it("builds content-addressed keys with safe extensions", () => {
		expect(buildAssetKey(validHash, "image/png")).toBe(
			`assets/01/${validHash}.png`,
		);
		expect(buildAssetKey(validHash, "image/jpeg; charset=binary")).toBe(
			`assets/01/${validHash}.jpg`,
		);
		expect(buildAssetKey(validHash, "application/pdf")).toBe(
			`assets/01/${validHash}.pdf`,
		);
		expect(buildAssetKey(validHash, "application/octet-stream")).toBe(
			`assets/01/${validHash}.bin`,
		);
	});

	it("falls back to bin for missing, empty, and unknown MIME types", () => {
		for (const mimeType of [null, undefined, "", "   ", "application/x-custom"]) {
			expect(buildAssetKey(validHash, mimeType)).toBe(
				`assets/01/${validHash}.bin`,
			);
		}
	});

	it("rejects invalid content hashes before building paths", () => {
		for (const hash of ["abc", "../bad", `${validHash}/x`, validHash.toUpperCase()]) {
			expect(() => buildAssetKey(hash, "image/png")).toThrow(
				"Invalid asset content hash",
			);
		}
	});
});

describe("cdnUrlForKey", () => {
	it("joins CDN base URLs and asset keys without duplicate slashes", () => {
		expect(cdnUrlForKey("https://cdn.example.com/", "/assets/01/file.png")).toBe(
			"https://cdn.example.com/assets/01/file.png",
		);
	});
});

describe("contentHashForBytes", () => {
	it("hashes byte content with SHA-256", async () => {
		const bytes = new TextEncoder().encode("hello").buffer;

		await expect(contentHashForBytes(bytes)).resolves.toBe(
			"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
		);
	});
});

describe("uploadAssetIfMissing", () => {
	it("skips upload when the key already exists", async () => {
		const bucket: AssetBucket = {
			head: vi.fn().mockResolvedValue({ key: "assets/01/existing.png" }),
			put: vi.fn(),
		};

		await expect(
			uploadAssetIfMissing(bucket, "assets/01/existing.png", "body", {
				contentType: "image/png",
			}),
		).resolves.toBe(false);
		expect(bucket.put).not.toHaveBeenCalled();
	});

	it("uploads missing assets with HTTP metadata", async () => {
		const bucket: AssetBucket = {
			head: vi.fn().mockResolvedValue(null),
			put: vi.fn().mockResolvedValue(undefined),
		};

		await expect(
			uploadAssetIfMissing(bucket, "assets/01/new.png", "body", {
				contentType: "image/png",
				cacheControl: "public, max-age=31536000, immutable",
			}),
		).resolves.toBe(true);
		expect(bucket.put).toHaveBeenCalledWith("assets/01/new.png", "body", {
			httpMetadata: {
				contentType: "image/png",
				cacheControl: "public, max-age=31536000, immutable",
			},
		});
	});
});
