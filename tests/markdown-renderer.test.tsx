import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "../app/lib/markdown";

describe("Markdown", () => {
	it("renders angle-bracket links and images with encoded parentheses", () => {
		render(
			<Markdown
				markdown={`[Useful link](<https://example.com/post>)

![Diagram](<https://example.com/assets/image%20(final).png?size=large%20value>)`}
			/>,
		);

		expect(screen.getByRole("link", { name: "Useful link" })).toHaveAttribute(
			"href",
			"https://example.com/post",
		);
		expect(screen.getByRole("img", { name: "Diagram" })).toHaveAttribute(
			"src",
			"https://example.com/assets/image%20(final).png?size=large%20value",
		);
	});

	it("rejects unsafe link and image schemes", () => {
		render(
			<Markdown
				markdown={`[Unsafe link](javascript:alert(1))

![Unsafe image](data:text/html,alert(1))`}
			/>,
		);

		expect(screen.queryByRole("link", { name: "Unsafe link" })).toBeNull();
		expect(screen.queryByRole("img", { name: "Unsafe image" })).toBeNull();
		expect(screen.getByText("Unsafe link")).toBeTruthy();
		expect(screen.getByText("Unsafe image")).toBeTruthy();
	});

	it("renders production block markdown for ordered lists, quotes, and dividers", () => {
		const { container } = render(
			<Markdown
				markdown={`1. First
2. Second

> Heads up
> child text

---`}
			/>,
		);

		const list = screen.getByRole("list");
		expect(list.tagName).toBe("OL");
		expect(within(list).getAllByRole("listitem")).toHaveLength(2);
		expect(container.querySelector("blockquote")?.textContent).toContain(
			"Heads up",
		);
		expect(container.querySelector("hr")).toBeTruthy();
	});

	it("renders production rich text annotations without exposing raw markdown", () => {
		const { container } = render(
			<Markdown markdown="**Bold** *Italic* ~~Gone~~ <u>Under</u> `code` $E=mc^2$" />,
		);

		expect(container.querySelector("strong")?.textContent).toBe("Bold");
		expect(container.querySelector("em")?.textContent).toBe("Italic");
		expect(container.querySelector("s")?.textContent).toBe("Gone");
		expect(container.querySelector("u")?.textContent).toBe("Under");
		expect(container.querySelector("code")?.textContent).toBe("code");
		expect(container.querySelector(".math-inline")?.textContent).toBe("E=mc^2");
		expect(container.textContent).not.toContain("**");
		expect(container.textContent).not.toContain("~~");
		expect(container.textContent).not.toContain("<u>");
	});

	it("does not render arbitrary inline HTML from markdown text", () => {
		const { container } = render(
			<Markdown markdown="<script>alert(1)</script> <u>Allowed underline</u>" />,
		);

		expect(container.querySelector("script")).toBeNull();
		expect(container.textContent).toContain("<script>alert(1)</script>");
		expect(container.querySelector("u")?.textContent).toBe("Allowed underline");
	});

	it("renders annotations inside link labels", () => {
		const { container } = render(
			<Markdown markdown="[**Bold link** and `code`](<https://example.com>)" />,
		);

		const link = screen.getByRole("link", { name: "Bold link and code" });
		expect(link).toHaveAttribute("href", "https://example.com");
		expect(within(link).getByText("Bold link").tagName).toBe("STRONG");
		expect(container.querySelector("a code")?.textContent).toBe("code");
		expect(link.textContent).not.toContain("**");
		expect(link.textContent).not.toContain("`");
	});
});
