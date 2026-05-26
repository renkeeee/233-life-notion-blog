import { describe, expect, it } from "vitest";
import {
	extractMarkdownImageUrls,
	normalizeLocalPostSlug,
	thumbnailUrlForImage,
	validateLocalImageUpload,
	validateLocalDraftInput,
	validateLocalPublishInput,
} from "../workers/local-posts";

describe("local post utilities", () => {
	it("normalizes local post slugs", () => {
		expect(normalizeLocalPostSlug(" Hello World 2026 ")).toBe(
			"hello-world-2026",
		);
		expect(normalizeLocalPostSlug("A__B---C")).toBe("a-b-c");
	});

	it("rejects publish input with an invalid slug", () => {
		expect(() =>
			validateLocalPublishInput({
				title: "Hello",
				slug: "Hello World",
				markdown: "Published body",
			}),
		).toThrow("Slug must contain only lowercase letters, numbers, and hyphens");
	});

	it("rejects draft input with leading whitespace in slug", () => {
		expect(() =>
			validateLocalDraftInput({
				title: "Hello",
				slug: " hello",
			}),
		).toThrow("Slug must contain only lowercase letters, numbers, and hyphens");
	});

	it("rejects draft input with a non-string slug", () => {
		expect(() =>
			validateLocalDraftInput({
				title: "Draft",
				slug: 123,
			}),
		).toThrow("Slug must be a string");
	});

	it("accepts draft input with empty optional content", () => {
		expect(
			validateLocalDraftInput({
				title: "Draft",
				slug: "",
				markdown: "",
				tags: ["life", "notes"],
			}),
		).toMatchObject({
			title: "Draft",
			slug: null,
			markdown: "",
			tags: ["life", "notes"],
		});
	});

	it("preserves draft markdown verbatim", () => {
		const markdown = "\n    const value = 1;\n\nTrailing space  \n";

		expect(
			validateLocalDraftInput({
				title: "Draft",
				markdown,
			}).markdown,
		).toBe(markdown);
	});

	it("rejects malformed optional string fields", () => {
		expect(() =>
			validateLocalDraftInput({
				title: "Draft",
				excerpt: 123,
			}),
		).toThrow("Excerpt must be a string");
	});

	it("rejects malformed commentsEnabled values", () => {
		expect(() =>
			validateLocalDraftInput({
				title: "Draft",
				commentsEnabled: "true",
			}),
		).toThrow("Comments enabled must be a boolean");
	});

	it("extracts markdown image URLs in document order", () => {
		expect(
			extractMarkdownImageUrls(
				[
					"![First](https://cdn.example.com/one.png)",
					"[Regular link](https://example.com)",
					"![Second image](<https://cdn.example.com/two final.png>)",
					"![Third](../assets/three.jpg \"Third image\")",
				].join("\n\n"),
			),
		).toEqual([
			"https://cdn.example.com/one.png",
			"https://cdn.example.com/two final.png",
			"../assets/three.jpg",
		]);
	});

	it.each([
		["image/jpeg", "image/jpeg"],
		["image/jpg", "image/jpeg"],
		["image/png; charset=binary", "image/png"],
		["image/webp", "image/webp"],
		["image/gif", "image/gif"],
	])("accepts %s local image uploads", (contentType, expected) => {
		expect(validateLocalImageUpload(contentType, 4)).toEqual({
			contentType: expected,
			size: 4,
		});
	});

	it("rejects unsupported local image upload types", () => {
		expect(() => validateLocalImageUpload("application/pdf", 4)).toThrow(
			"Unsupported image type",
		);
	});

	it("rejects local image uploads larger than 10MB", () => {
		expect(() =>
			validateLocalImageUpload("image/png", 10 * 1024 * 1024 + 1),
		).toThrow("Image must be at most 10MB");
	});

	it("preserves query strings in image thumbnail URLs", () => {
		expect(
			thumbnailUrlForImage("https://assets.233.life/assets/a.jpg?v=2"),
		).toBe(
			"https://assets.233.life/cdn-cgi/image/width=440,quality=82,format=auto/assets/a.jpg?v=2",
		);
	});
});
