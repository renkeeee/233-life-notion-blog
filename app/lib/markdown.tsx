import type { ReactNode } from "react";

type InlineNode =
	| { type: "text"; value: string }
	| { type: "link"; label: string; href: string }
	| { type: "image"; alt: string; src: string };

type BlockNode =
	| { type: "heading"; level: 1 | 2 | 3; text: string }
	| { type: "paragraph"; text: string }
	| { type: "list"; items: string[] }
	| { type: "code"; code: string };

function safeUrl(url: string): string | null {
	const trimmed = url.trim();
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

function inlineTokens(text: string): InlineNode[] {
	const tokens: InlineNode[] = [];
	const pattern = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(text)) !== null) {
		if (match.index > lastIndex) {
			tokens.push({ type: "text", value: text.slice(lastIndex, match.index) });
		}

		if (match[1] !== undefined && match[2] !== undefined) {
			const src = safeUrl(match[2]);
			tokens.push(
				src
					? { type: "image", alt: match[1], src }
					: { type: "text", value: match[1] },
			);
		} else if (match[3] !== undefined && match[4] !== undefined) {
			const href = safeUrl(match[4]);
			tokens.push(
				href
					? { type: "link", label: match[3], href }
					: { type: "text", value: match[3] },
			);
		}

		lastIndex = pattern.lastIndex;
	}

	if (lastIndex < text.length) {
		tokens.push({ type: "text", value: text.slice(lastIndex) });
	}

	return tokens;
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

		if (/^\s*[-*]\s+/.test(line)) {
			const items: string[] = [];
			while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? "")) {
				items.push((lines[index] ?? "").replace(/^\s*[-*]\s+/, "").trim());
				index += 1;
			}
			index -= 1;
			blocks.push({ type: "list", items });
			continue;
		}

		const paragraphLines = [line.trim()];
		while (
			index + 1 < lines.length &&
			lines[index + 1]?.trim() &&
			!lines[index + 1]?.trimStart().startsWith("```") &&
			!/^(#{1,3})\s+/.test(lines[index + 1] ?? "") &&
			!/^\s*[-*]\s+/.test(lines[index + 1] ?? "")
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
					return (
						<ul key={index}>
							{block.items.map((item, itemIndex) => (
								<li key={itemIndex}>{renderInline(item, `list-${index}-${itemIndex}`)}</li>
							))}
						</ul>
					);
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
