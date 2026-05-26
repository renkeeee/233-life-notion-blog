import { describe, expect, it } from "vitest";
import {
	extractMarkdownImageUrls,
	normalizeLocalPostSlug,
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
});
