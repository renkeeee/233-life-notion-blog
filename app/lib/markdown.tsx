import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Schema } from "hast-util-sanitize";
import remarkGfm from "remark-gfm";

const sanitizeSchema: Schema = {
	...defaultSchema,
	tagNames: [...(defaultSchema.tagNames ?? []), "u", "span"],
	attributes: {
		...defaultSchema.attributes,
		input: [
			...(defaultSchema.attributes?.input ?? []),
			["checked", true],
		],
		span: [["className", "math-inline"]],
	},
};

const components: Components = {
	img({ alt, src }) {
		if (!src) {
			return <>{alt}</>;
		}

		return <img src={src} alt={alt ?? ""} loading="lazy" />;
	},
	del({ children }) {
		return <s>{children}</s>;
	},
};

function safeUrl(value: string): string {
	const trimmed = normalizeDestination(value);
	if (
		trimmed.startsWith("/") ||
		trimmed.startsWith("#") ||
		/^https?:\/\//i.test(trimmed) ||
		/^mailto:/i.test(trimmed)
	) {
		return trimmed;
	}

	return "";
}

function normalizeDestination(value: string): string {
	const trimmed = value.trim();
	if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
		return trimmed.slice(1, -1).trim();
	}

	return trimmed;
}

function markdownWithInlineMath(markdown: string): string {
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	let inFence = false;

	return lines
		.map((line) => {
			if (line.trimStart().startsWith("```")) {
				inFence = !inFence;
				return line;
			}

			return inFence ? line : inlineMathToHtml(line);
		})
		.join("\n");
}

function inlineMathToHtml(value: string): string {
	let result = "";

	for (let index = 0; index < value.length; index += 1) {
		if (value[index] === "`") {
			const marker = backtickMarkerAt(value, index);
			const endIndex = value.indexOf(marker, index + marker.length);
			if (endIndex === -1) {
				result += value.slice(index);
				break;
			}

			result += value.slice(index, endIndex + marker.length);
			index = endIndex + marker.length - 1;
			continue;
		}

		if (value[index] === "$") {
			const endIndex = value.indexOf("$", index + 1);
			if (endIndex !== -1) {
				const expression = value.slice(index + 1, endIndex);
				result += `<span class="math-inline">${escapeHtml(expression)}</span>`;
				index = endIndex;
				continue;
			}
		}

		result += value[index];
	}

	return result;
}

function backtickMarkerAt(value: string, startIndex: number): string {
	let endIndex = startIndex;
	while (value[endIndex] === "`") {
		endIndex += 1;
	}

	return value.slice(startIndex, endIndex);
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});
}

export function Markdown({ markdown }: { markdown: string }) {
	return (
		<div className="markdown">
			<ReactMarkdown
				components={components}
				rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
				remarkPlugins={[remarkGfm]}
				urlTransform={safeUrl}
			>
				{markdownWithInlineMath(markdown)}
			</ReactMarkdown>
		</div>
	);
}
