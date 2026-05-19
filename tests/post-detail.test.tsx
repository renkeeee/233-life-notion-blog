import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { PostDetail } from "../app/components/public/PostDetail";

describe("PostDetail", () => {
	it("does not render the Notion page cover above the markdown body", () => {
		const { container } = render(
			<MemoryRouter>
				<PostDetail
					post={{
						id: "post-1",
						slug: "hello-world",
						title: "Hello World",
						coverUrl: "https://cdn.example.com/cover.jpg",
						publishedAt: "2026-05-19T00:00:00.000Z",
						updatedAt: "2026-05-19T00:00:00.000Z",
						markdown: "Body copy",
					}}
				/>
			</MemoryRouter>,
		);

		expect(screen.getByRole("heading", { name: "Hello World" })).toBeTruthy();
		expect(screen.getByText("Body copy")).toBeTruthy();
		expect(container.querySelector(".post-hero-image")).toBeNull();
		expect(container.querySelector('img[src="https://cdn.example.com/cover.jpg"]')).toBeNull();
	});
});
