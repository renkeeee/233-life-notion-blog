import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { PostDetail } from "../app/components/public/PostDetail";
import * as apiClient from "../app/lib/api-client";
import Post from "../app/routes/post";

describe("PostDetail", () => {
	it("does not render the Notion page cover above the markdown body", () => {
		const { container } = render(
			<MemoryRouter>
				<PostDetail
					post={{
						id: "post-1",
						slug: "hello-world",
						title: "Hello World",
						excerpt: "Opening body text.",
						coverUrl: "https://cdn.example.com/cover.jpg",
						category: "Essay",
						tags: ["Life", "Notes"],
						publishedAt: "2026-05-19T00:00:00.000Z",
						updatedAt: "2026-05-19T00:00:00.000Z",
						markdown: "Body copy",
					}}
				/>
			</MemoryRouter>,
		);

		expect(screen.getByRole("heading", { name: "Hello World" })).toBeTruthy();
		expect(screen.getByText("Life")).toHaveClass("post-tag");
		expect(screen.getByText("Notes")).toHaveClass("post-tag");
		expect(screen.getByLabelText("Post category")).toHaveTextContent("Essay");
		expect(screen.getByLabelText("Post category")).toHaveClass("detail-category");
		expect(screen.getByText("Body copy")).toBeTruthy();
		expect(container.querySelector(".post-hero-image")).toBeNull();
		expect(container.querySelector('img[src="https://cdn.example.com/cover.jpg"]')).toBeNull();
	});

	it("shows a post detail skeleton while the post is loading", () => {
		const apiGet = vi
			.spyOn(apiClient, "apiGet")
			.mockReturnValue(new Promise(() => {}));
		try {
			render(
				<MemoryRouter initialEntries={["/post/hello-world"]}>
					<Routes>
						<Route path="/post/:slug" element={<Post />} />
					</Routes>
				</MemoryRouter>,
			);

			expect(screen.getByLabelText("Loading post")).toHaveClass(
				"post-detail-skeleton",
			);
			expect(screen.queryByText("Loading post...")).toBeNull();
		} finally {
			apiGet.mockRestore();
		}
	});
});
