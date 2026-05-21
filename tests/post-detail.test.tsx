import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

	it("renders comments and submits anonymous comments", async () => {
		const apiPost = vi.spyOn(apiClient, "apiPost").mockResolvedValue({
			comment: {
				id: "comment-2",
				nickname: "Anonymous",
				body: "A quiet reply.",
				createdAt: "2026-05-20T10:00:00.000Z",
			},
		});

		try {
			render(
				<MemoryRouter>
					<PostDetail
						post={{
							id: "post-1",
							slug: "hello-world",
							title: "Hello World",
							excerpt: "Opening body text.",
							coverUrl: null,
							category: null,
							tags: [],
							publishedAt: "2026-05-19T00:00:00.000Z",
							updatedAt: "2026-05-19T00:00:00.000Z",
							markdown: "Body copy",
							commentsEnabled: true,
							comments: [
								{
									id: "comment-1",
									nickname: "Renke",
									body: "First note.",
									createdAt: "2026-05-19T08:00:00.000Z",
								},
							],
						}}
					/>
				</MemoryRouter>,
			);

			expect(screen.getByRole("heading", { name: "Comments" })).toBeTruthy();
			expect(screen.getByText("First note.")).toBeTruthy();
			expect(screen.queryByLabelText("Comment")).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Comment" }));
			fireEvent.change(screen.getByLabelText("Comment"), {
				target: { value: "A quiet reply." },
			});
			fireEvent.click(screen.getByRole("button", { name: "Post comment" }));

			await waitFor(() =>
				expect(apiPost).toHaveBeenCalledWith(
					"/api/posts/hello-world/comments",
					{
						nickname: "",
						body: "A quiet reply.",
						turnstileToken: "",
					},
				),
			);
			await screen.findByText("Anonymous");
			expect(screen.getByText("A quiet reply.")).toBeTruthy();
		} finally {
			apiPost.mockRestore();
		}
	});

	it("shows a post detail skeleton while the post is loading", () => {
		const apiGet = vi
			.spyOn(apiClient, "apiGet")
			.mockReturnValue(new Promise(() => {}));
		const historyBack = vi
			.spyOn(window.history, "back")
			.mockImplementation(() => {});
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
			expect(screen.queryByRole("heading", { name: "233.life" })).toBeNull();
			expect(screen.queryByRole("link", { name: "Archived" })).toBeNull();
			expect(
				screen.getByRole("button", { name: "Theme mode: auto" }),
			).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Go back" }));
			expect(historyBack).toHaveBeenCalledTimes(1);
			expect(screen.queryByText("Loading post...")).toBeNull();
		} finally {
			apiGet.mockRestore();
			historyBack.mockRestore();
		}
	});

	it("prompts for a password and unlocks locked post details", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			locked: true,
			slug: "locked-post",
			title: "Locked post",
		});
		const apiPost = vi.spyOn(apiClient, "apiPost").mockResolvedValue({
			id: "post-1",
			slug: "locked-post",
			title: "Locked post",
			excerpt: "Private opening.",
			coverUrl: null,
			category: null,
			tags: [],
			publishedAt: "2026-05-19T00:00:00.000Z",
			updatedAt: "2026-05-19T00:00:00.000Z",
			markdown: "Private body",
		});

		try {
			render(
				<MemoryRouter initialEntries={["/post/locked-post"]}>
					<Routes>
						<Route path="/post/:slug" element={<Post />} />
					</Routes>
				</MemoryRouter>,
			);

			await screen.findByRole("heading", { name: "Locked post" });
			expect(screen.queryByText("All posts")).toBeNull();
			expect(screen.getByLabelText("Post password")).toBeTruthy();
			fireEvent.change(screen.getByLabelText("Post password"), {
				target: { value: "open-sesame" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Unlock post" }));

			await waitFor(() =>
				expect(apiPost).toHaveBeenCalledWith(
					"/api/posts/locked-post/unlock",
					{ password: "open-sesame" },
				),
			);
			await screen.findByText("Private body");
			expect(screen.queryByText("All posts")).toBeNull();
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
		}
	});
});
