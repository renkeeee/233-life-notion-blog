import { describe, expect, it } from "vitest";
import {
	blocksToMarkdown,
	extractBlockAssetRefs,
	normalizedBlocksHash,
	type NotionBlock,
} from "../workers/notion/blocks";

const notionImageUrl =
	"https://prod-files-secure.s3.us-west-2.amazonaws.com/image.png?X-Amz-Signature=temp";
const notionFileUrl =
	"https://prod-files-secure.s3.us-west-2.amazonaws.com/report.pdf?X-Amz-Signature=temp";

function richText(plainText: string): Array<{ plain_text: string }> {
	return [{ plain_text: plainText }];
}

describe("blocksToMarkdown", () => {
	it("converts common Notion blocks into Markdown", () => {
		const blocks: NotionBlock[] = [
			{
				id: "heading",
				type: "heading_1",
				heading_1: { rich_text: richText("Launch Notes") },
			},
			{
				id: "paragraph",
				type: "paragraph",
				paragraph: {
					rich_text: richText("First line\nsecond line"),
				},
			},
			{
				id: "bullet",
				type: "bulleted_list_item",
				bulleted_list_item: { rich_text: richText("Ship converter") },
			},
			{
				id: "number",
				type: "numbered_list_item",
				numbered_list_item: { rich_text: richText("Cache assets") },
			},
			{
				id: "quote",
				type: "quote",
				quote: { rich_text: richText("quoted\ntext") },
			},
			{
				id: "divider",
				type: "divider",
				divider: {},
			},
			{
				id: "todo",
				type: "to_do",
				to_do: { rich_text: richText("Verify sync"), checked: true },
			},
			{
				id: "code",
				type: "code",
				code: {
					language: "typescript",
					rich_text: richText("const fence = ```;\nconsole.log(fence);"),
				},
			},
			{
				id: "image",
				type: "image",
				image: {
					type: "file",
					file: { url: notionImageUrl },
					caption: richText("Architecture"),
				},
			},
			{
				id: "file",
				type: "file",
				file: {
					type: "file",
					file: { url: notionFileUrl },
					caption: richText("Download report"),
				},
			},
			{
				id: "unsupported",
				type: "unsupported",
				unsupported: {},
				children: [
					{
						id: "child",
						type: "paragraph",
						paragraph: { rich_text: richText("nested child") },
					},
				],
			},
		];

		expect(
			blocksToMarkdown(blocks, {
				assetUrlMap: {
					[notionImageUrl]: "https://cdn.example.com/assets/ab/image.png",
					[notionFileUrl]: "https://cdn.example.com/assets/cd/report.pdf",
				},
			}),
		).toBe(`# Launch Notes

First line
second line

- Ship converter

1. Cache assets

> quoted
> text

---

- [x] Verify sync

\`\`\`\`typescript
const fence = \`\`\`;
console.log(fence);
\`\`\`\`

![Architecture](https://cdn.example.com/assets/ab/image.png)

[Download report](https://cdn.example.com/assets/cd/report.pdf)

nested child`);
	});

	it("renders simple embeds and nested children without throwing on unknown shapes", () => {
		const blocks: NotionBlock[] = [
			{
				id: "callout",
				type: "callout",
				callout: { rich_text: richText("Heads up") },
				children: [
					{
						id: "child",
						type: "paragraph",
						paragraph: { rich_text: richText("child text") },
					},
				],
			},
			{
				id: "bookmark",
				type: "bookmark",
				bookmark: {
					url: "https://example.com/post",
					caption: richText("Useful link"),
				},
			},
			{
				id: "bad",
				type: "paragraph",
				paragraph: null,
			},
		];

		expect(blocksToMarkdown(blocks)).toBe(`> Heads up
> child text

[Useful link](https://example.com/post)`);
	});
});

describe("extractBlockAssetRefs", () => {
	it("extracts downloadable asset references from file-like blocks", () => {
		const blocks: NotionBlock[] = [
			{
				id: "image",
				type: "image",
				image: {
					type: "file",
					file: { url: notionImageUrl },
					caption: richText("Architecture"),
				},
			},
			{
				id: "video",
				type: "video",
				video: {
					type: "external",
					external: { url: "https://cdn.notion.site/video.mp4" },
				},
			},
			{
				id: "page",
				type: "paragraph",
				paragraph: { rich_text: richText("no asset") },
			},
		];

		expect(extractBlockAssetRefs(blocks)).toEqual([
			{
				blockId: "image",
				blockType: "image",
				url: notionImageUrl,
				caption: "Architecture",
			},
			{
				blockId: "video",
				blockType: "video",
				url: "https://cdn.notion.site/video.mp4",
				caption: "",
			},
		]);
	});
});

describe("normalizedBlocksHash", () => {
	it("ignores volatile Notion metadata but changes when semantic content changes", async () => {
		const original: NotionBlock[] = [
			{
				id: "block-id",
				type: "paragraph",
				created_time: "2026-01-01T00:00:00.000Z",
				last_edited_time: "2026-01-01T00:00:00.000Z",
				created_by: { object: "user", id: "user-a" },
				last_edited_by: { object: "user", id: "user-b" },
				archived: false,
				in_trash: false,
				paragraph: { rich_text: richText("Stable content") },
			},
		];
		const metadataChanged: NotionBlock[] = [
			{
				...original[0],
				id: "different-block-id",
				created_time: "2026-05-01T00:00:00.000Z",
				last_edited_time: "2026-05-02T00:00:00.000Z",
				created_by: { object: "user", id: "user-c" },
				last_edited_by: { object: "user", id: "user-d" },
				archived: true,
				in_trash: true,
			},
		];
		const contentChanged: NotionBlock[] = [
			{
				...original[0],
				paragraph: { rich_text: richText("Changed content") },
			},
		];

		await expect(normalizedBlocksHash(metadataChanged)).resolves.toBe(
			await normalizedBlocksHash(original),
		);
		await expect(normalizedBlocksHash(contentChanged)).resolves.not.toBe(
			await normalizedBlocksHash(original),
		);
	});

	it("ignores rotated Notion-hosted file signatures and expiry times", async () => {
		const firstSnapshot: NotionBlock[] = [
			{
				id: "image",
				type: "image",
				image: {
					type: "file",
					file: {
						url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/space/image.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=first",
						expiry_time: "2026-05-18T01:00:00.000Z",
					},
					caption: richText("Architecture"),
				},
			},
			{
				id: "file",
				type: "file",
				file: {
					type: "file",
					file: {
						url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/space/report.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=first",
						expiry_time: "2026-05-18T01:00:00.000Z",
					},
					caption: richText("Report"),
				},
			},
		];
		const refreshedSnapshot: NotionBlock[] = [
			{
				...firstSnapshot[0],
				image: {
					type: "file",
					file: {
						url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/space/image.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=second",
						expiry_time: "2026-05-18T02:00:00.000Z",
					},
					caption: richText("Architecture"),
				},
			},
			{
				...firstSnapshot[1],
				file: {
					type: "file",
					file: {
						url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/space/report.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=second",
						expiry_time: "2026-05-18T02:00:00.000Z",
					},
					caption: richText("Report"),
				},
			},
		];

		await expect(normalizedBlocksHash(refreshedSnapshot)).resolves.toBe(
			await normalizedBlocksHash(firstSnapshot),
		);
	});

	it("preserves external URL query strings in the normalized hash", async () => {
		const original: NotionBlock[] = [
			{
				id: "image",
				type: "image",
				image: {
					type: "external",
					external: {
						url: "https://example.com/image.png?version=one",
					},
				},
			},
		];
		const changedQuery: NotionBlock[] = [
			{
				...original[0],
				image: {
					type: "external",
					external: {
						url: "https://example.com/image.png?version=two",
					},
				},
			},
		];

		await expect(normalizedBlocksHash(changedQuery)).resolves.not.toBe(
			await normalizedBlocksHash(original),
		);
	});
});
