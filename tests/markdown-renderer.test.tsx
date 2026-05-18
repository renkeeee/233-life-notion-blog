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
});
