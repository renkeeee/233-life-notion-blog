import type { ReactNode } from "react";

type InlineNode =
	| { type: "text"; value: string }
	| { type: "link"; label: string; href: string }
	| { type: "image"; alt: string; src: string };

type BlockNode =
	| { type: "heading"; level: 1 | 2 | 3; text: string }
	| { type: "paragraph"; text: string }
	| { type: "list"; ordered: boolean; items: string[] }
	| { type: "quote"; lines: string[] }
	| { type: "divider" }
	| { type: "code"; code: string };

function safeUrl(url: string): string | null {
	const trimmed = normalizeDestination(url);
	if (
		trimmed.startsWith("/") ||
		trimmed.startsWith("#") ||
		/^https?:\/\//i.test(trimmed) ||
		/^mailto:/i.test(trimmed)
	) {
		return trimmed;
	}

	return null;
}

function normalizeDestination(url: string): string {
	const trimmed = url.trim();
	if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
		return trimmed.slice(1, -1).trim();
	}

	return trimmed;
}

function inlineTokens(text: string): InlineNode[] {
	const tokens: InlineNode[] = [];
	let lastIndex = 0;

	for (let index = 0; index < text.length; index += 1) {
		const image = text.startsWith("![", index);
		const link = !image && text[index] === "[";
		if (!image && !link) {
			continue;
		}

		const labelStart = index + (image ? 2 : 1);
		const labelEnd = text.indexOf("]", labelStart);
		if (labelEnd === -1 || text[labelEnd + 1] !== "(") {
			continue;
		}

		const destination = readDestination(text, labelEnd + 2);
		if (!destination) {
			continue;
		}

		if (index > lastIndex) {
			tokens.push({ type: "text", value: text.slice(lastIndex, index) });
		}

		const label = text.slice(labelStart, labelEnd);
		if (image) {
			const src = safeUrl(destination.value);
			tokens.push(
				src
					? { type: "image", alt: label, src }
					: { type: "text", value: label },
			);
		} else {
			const href = safeUrl(destination.value);
			tokens.push(
				href
					? { type: "link", label, href }
					: { type: "text", value: label },
			);
		}

		index = destination.endIndex;
		lastIndex = destination.endIndex + 1;
	}

	if (lastIndex < text.length) {
		tokens.push({ type: "text", value: text.slice(lastIndex) });
	}

	return tokens;
}

function readDestination(
	text: string,
	startIndex: number,
): { value: string; endIndex: number } | null {
	if (text[startIndex] === "<") {
		const endAngle = text.indexOf(">)", startIndex);
		if (endAngle === -1) {
			return null;
		}

		return {
			value: text.slice(startIndex, endAngle + 1),
			endIndex: endAngle + 1,
		};
	}

	let depth = 0;
	for (let index = startIndex; index < text.length; index += 1) {
		const char = text[index];
		if (char === "(") {
			depth += 1;
			continue;
		}
		if (char === ")") {
			if (depth === 0) {
				return {
					value: text.slice(startIndex, index),
					endIndex: index,
				};
			}
			depth -= 1;
		}
	}

	return null;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
	return inlineTokens(text).map((token, index) => {
		const key = `${keyPrefix}-${index}`;
		if (token.type === "link") {
			return (
				<a key={key} href={token.href}>
					{token.label}
				</a>
			);
		}
		if (token.type === "image") {
			return <img key={key} src={token.src} alt={token.alt} loading="lazy" />;
		}
		return token.value;
	});
}

function parseMarkdown(markdown: string): BlockNode[] {
	const blocks: BlockNode[] = [];
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (!line.trim()) {
			continue;
		}

		if (line.trimStart().startsWith("```")) {
			const codeLines: string[] = [];
			index += 1;
			while (index < lines.length && !lines[index]?.trimStart().startsWith("```")) {
				codeLines.push(lines[index] ?? "");
				index += 1;
			}
			blocks.push({ type: "code", code: codeLines.join("\n") });
			continue;
		}

		const heading = /^(#{1,3})\s+(.+)$/.exec(line);
		if (heading) {
			blocks.push({
				type: "heading",
				level: heading[1].length as 1 | 2 | 3,
				text: heading[2].trim(),
			});
			continue;
		}

		if (/^\s*---\s*$/.test(line)) {
			blocks.push({ type: "divider" });
			continue;
		}

		if (/^\s*>\s?/.test(line)) {
			const quoteLines: string[] = [];
			while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? "")) {
				quoteLines.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
				index += 1;
			}
			index -= 1;
			blocks.push({ type: "quote", lines: quoteLines });
			continue;
		}

		if (/^\s*[-*]\s+/.test(line)) {
			const items: string[] = [];
			while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
				items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/, "").trim());
				index += 1;
			}
			index -= 1;
			blocks.push({ type: "list", ordered: false, items });
			continue;
		}

		if (/^\s*\d+\.\s+/.test(line)) {
			const items: string[] = [];
			while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? "")) {
				items.push((lines[index] ?? "").replace(/^\s*\d+\.\s+/, "").trim());
				index += 1;
			}
			index -= 1;
			blocks.push({ type: "list", ordered: true, items });
			continue;
		}

		const paragraphLines = [line.trim()];
		while (
			index + 1 < lines.length &&
			lines[index + 1]?.trim() &&
			!lines[index + 1]?.trimStart().startsWith("```") &&
			!/^(#{1,3})\s+/.test(lines[index + 1] ?? "") &&
			!/^\s*[-*]\s+/.test(lines[index + 1] ?? "") &&
			!/^\s*\d+\.\s+/.test(lines[index + 1] ?? "") &&
			!/^\s*>\s?/.test(lines[index + 1] ?? "") &&
			!/^\s*---\s*$/.test(lines[index + 1] ?? "")
		) {
			index += 1;
			paragraphLines.push((lines[index] ?? "").trim());
		}
		blocks.push({ type: "paragraph", text: paragraphLines.join(" ") });
	}

	return blocks;
}

export function Markdown({ markdown }: { markdown: string }) {
	return (
		<div className="markdown">
			{parseMarkdown(markdown).map((block, index) => {
				if (block.type === "heading") {
					const Heading = `h${block.level}` as "h1" | "h2" | "h3";
					return (
						<Heading key={index}>{renderInline(block.text, `heading-${index}`)}</Heading>
					);
				}
				if (block.type === "list") {
					const List = block.ordered ? "ol" : "ul";
					return (
						<List key={index}>
							{block.items.map((item, itemIndex) => (
								<li key={itemIndex}>{renderInline(item, `list-${index}-${itemIndex}`)}</li>
							))}
						</List>
					);
				}
				if (block.type === "quote") {
					return (
						<blockquote key={index}>
							{block.lines.map((line, lineIndex) => (
								<p key={lineIndex}>{renderInline(line, `quote-${index}-${lineIndex}`)}</p>
							))}
						</blockquote>
					);
				}
				if (block.type === "divider") {
					return <hr key={index} />;
				}
				if (block.type === "code") {
					return (
						<pre key={index}>
							<code>{block.code}</code>
						</pre>
					);
				}
				return <p key={index}>{renderInline(block.text, `paragraph-${index}`)}</p>;
			})}
		</div>
	);
}
