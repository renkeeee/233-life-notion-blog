import { sha256Hex } from "../crypto";

export interface NotionRichText {
	plain_text?: string;
	[key: string]: unknown;
}

export interface NotionBlock {
	id?: string;
	type?: string;
	children?: NotionBlock[];
	[key: string]: unknown;
}

export interface BlockAssetRef {
	blockId?: string;
	blockType: string;
	url: string;
	caption: string;
}

export type AssetUrlMap = Record<string, string> | ReadonlyMap<string, string>;

export interface BlocksToMarkdownOptions {
	assetUrlMap?: AssetUrlMap;
}

const fileLikeBlockTypes = new Set([
	"image",
	"file",
	"audio",
	"video",
	"pdf",
]);

const volatileBlockKeys = new Set([
	"id",
	"object",
	"parent",
	"has_children",
	"created_time",
	"last_edited_time",
	"created_by",
	"last_edited_by",
	"archived",
	"in_trash",
]);

export function blocksToMarkdown(
	blocks: NotionBlock[],
	options: BlocksToMarkdownOptions = {},
): string {
	return renderBlocks(blocks, options, 0).trim();
}

export function extractBlockAssetRefs(blocks: NotionBlock[]): BlockAssetRef[] {
	const refs: BlockAssetRef[] = [];

	for (const block of blocks) {
		const type = typeof block.type === "string" ? block.type : "";
		const payload = blockPayload(block);

		if (type && fileLikeBlockTypes.has(type) && payload) {
			const url = fileObjectUrl(payload);
			if (url) {
				refs.push({
					blockId: block.id,
					blockType: type,
					url,
					caption: captionText(payload),
				});
			}
		}

		if (Array.isArray(block.children)) {
			refs.push(...extractBlockAssetRefs(block.children));
		}
	}

	return refs;
}

export async function normalizedBlocksHash(
	blocks: NotionBlock[],
): Promise<string> {
	return sha256Hex(stableStringify(normalizeForHash(blocks)));
}

function renderBlocks(
	blocks: NotionBlock[],
	options: BlocksToMarkdownOptions,
	depth: number,
): string {
	const rendered: string[] = [];
	let numberedListIndex = 0;

	for (const block of blocks) {
		if (block.type === "numbered_list_item") {
			numberedListIndex += 1;
		} else {
			numberedListIndex = 0;
		}

		const markdown = renderBlock(block, options, depth, numberedListIndex || 1);
		if (markdown) {
			rendered.push(markdown);
		}
	}

	return rendered.join("\n\n");
}

function renderBlock(
	block: NotionBlock,
	options: BlocksToMarkdownOptions,
	depth: number,
	listNumber: number,
): string {
	const type = typeof block.type === "string" ? block.type : "";
	const payload = blockPayload(block);
	const children = Array.isArray(block.children)
		? renderBlocks(block.children, options, depth + 1)
		: "";
	let markdown = "";

	switch (type) {
		case "heading_1":
			markdown = headingMarkdown(1, payload);
			break;
		case "heading_2":
			markdown = headingMarkdown(2, payload);
			break;
		case "heading_3":
			markdown = headingMarkdown(3, payload);
			break;
		case "paragraph":
			markdown = richTextPlainText(payload);
			break;
		case "bulleted_list_item":
			markdown = listItemMarkdown("-", payload, children);
			break;
		case "numbered_list_item":
			markdown = listItemMarkdown(`${listNumber}.`, payload, children);
			break;
		case "quote":
			markdown = quoteMarkdown(richTextPlainText(payload), children);
			break;
		case "divider":
			markdown = "---";
			break;
		case "code":
			markdown = codeMarkdown(payload);
			break;
		case "image":
			markdown = imageMarkdown(payload, options);
			break;
		case "file":
			markdown = fileMarkdown(payload, options);
			break;
		case "to_do":
			markdown = todoMarkdown(payload, children);
			break;
		case "callout":
			markdown = quoteMarkdown(richTextPlainText(payload), children);
			break;
		case "bookmark":
		case "link_preview":
		case "video":
		case "audio":
		case "pdf":
			markdown = embedMarkdown(type, payload, options);
			break;
		default:
			markdown = "";
	}

	if (!markdown && children) {
		return children;
	}

	return markdown;
}

function headingMarkdown(level: 1 | 2 | 3, payload: Record<string, unknown> | null) {
	const text = richTextPlainText(payload);

	return text ? `${"#".repeat(level)} ${text}` : "";
}

function listItemMarkdown(
	marker: string,
	payload: Record<string, unknown> | null,
	children: string,
): string {
	const text = richTextPlainText(payload);
	const firstLine = `${marker} ${text}`.trimEnd();

	if (!children) {
		return firstLine;
	}

	return `${firstLine}\n${indentLines(children, "  ")}`;
}

function todoMarkdown(
	payload: Record<string, unknown> | null,
	children: string,
): string {
	const checked = payload?.checked === true ? "x" : " ";
	const text = richTextPlainText(payload);
	const firstLine = `- [${checked}] ${text}`.trimEnd();

	if (!children) {
		return firstLine;
	}

	return `${firstLine}\n${indentLines(children, "  ")}`;
}

function quoteMarkdown(text: string, children: string): string {
	const body = [text, children].filter(Boolean).join("\n");

	return body
		.split("\n")
		.map((line) => (line ? `> ${line}` : ">"))
		.join("\n");
}

function codeMarkdown(payload: Record<string, unknown> | null): string {
	const code = richTextPlainText(payload);
	const language =
		typeof payload?.language === "string"
			? payload.language.trim().replace(/[` \n\r\t]/g, "")
			: "";
	const longestBacktickRun = Math.max(
		0,
		...Array.from(code.matchAll(/`+/g), (match) => match[0].length),
	);
	const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));

	return `${fence}${language}\n${code}\n${fence}`;
}

function imageMarkdown(
	payload: Record<string, unknown> | null,
	options: BlocksToMarkdownOptions,
): string {
	const url = rewrittenUrl(fileObjectUrl(payload), options);
	if (!url) {
		return "";
	}

	const label = captionText(payload) || "image";

	return `![${escapeMarkdownLinkText(label)}](${url})`;
}

function fileMarkdown(
	payload: Record<string, unknown> | null,
	options: BlocksToMarkdownOptions,
): string {
	const url = rewrittenUrl(fileObjectUrl(payload), options);
	if (!url) {
		return "";
	}

	const label = captionText(payload) || "file";

	return `[${escapeMarkdownLinkText(label)}](${url})`;
}

function embedMarkdown(
	type: string,
	payload: Record<string, unknown> | null,
	options: BlocksToMarkdownOptions,
): string {
	const url = rewrittenUrl(fileObjectUrl(payload) ?? directUrl(payload), options);
	if (!url) {
		return "";
	}

	const label = captionText(payload) || type.replaceAll("_", " ");

	return `[${escapeMarkdownLinkText(label)}](${url})`;
}

function richTextPlainText(payload: Record<string, unknown> | null): string {
	if (!payload || !Array.isArray(payload.rich_text)) {
		return "";
	}

	return payload.rich_text
		.map((item) => {
			if (!isRecord(item)) {
				return "";
			}

			return typeof item.plain_text === "string" ? item.plain_text : "";
		})
		.join("");
}

function captionText(payload: Record<string, unknown> | null): string {
	if (!payload || !Array.isArray(payload.caption)) {
		return "";
	}

	return payload.caption
		.map((item) => {
			if (!isRecord(item)) {
				return "";
			}

			return typeof item.plain_text === "string" ? item.plain_text : "";
		})
		.join("");
}

function fileObjectUrl(payload: Record<string, unknown> | null): string | null {
	if (!payload) {
		return null;
	}

	const typedUrl = nestedUrl(payload, payload.type);
	if (typedUrl) {
		return typedUrl;
	}

	for (const key of ["file", "external", "uploaded_file", "upload"]) {
		const url = nestedUrl(payload, key);
		if (url) {
			return url;
		}
	}

	return directUrl(payload);
}

function nestedUrl(
	payload: Record<string, unknown>,
	key: unknown,
): string | null {
	if (typeof key !== "string") {
		return null;
	}

	const nested = payload[key];

	return isRecord(nested) && typeof nested.url === "string" ? nested.url : null;
}

function directUrl(payload: Record<string, unknown> | null): string | null {
	return payload && typeof payload.url === "string" ? payload.url : null;
}

function rewrittenUrl(
	url: string | null,
	options: BlocksToMarkdownOptions,
): string | null {
	if (!url || !options.assetUrlMap) {
		return url;
	}

	const assetUrlMap = options.assetUrlMap;

	if (isReadonlyMap(assetUrlMap)) {
		return assetUrlMap.get(url) ?? url;
	}

	return assetUrlMap[url] ?? url;
}

function blockPayload(block: NotionBlock): Record<string, unknown> | null {
	if (typeof block.type !== "string") {
		return null;
	}

	const payload = block[block.type];

	return isRecord(payload) ? payload : null;
}

function indentLines(value: string, indent: string): string {
	return value
		.split("\n")
		.map((line) => `${indent}${line}`)
		.join("\n");
}

function escapeMarkdownLinkText(value: string): string {
	return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function normalizeForHash(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => normalizeForHash(item));
	}

	if (!isRecord(value)) {
		return value;
	}

	const normalized: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		if (volatileBlockKeys.has(key)) {
			continue;
		}

		const child = normalizeForHash(value[key]);
		if (child !== undefined) {
			normalized[key] = child;
		}
	}

	return normalized;
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}

	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
			.join(",")}}`;
	}

	return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReadonlyMap(value: AssetUrlMap): value is ReadonlyMap<string, string> {
	return typeof (value as ReadonlyMap<string, string>).get === "function";
}
