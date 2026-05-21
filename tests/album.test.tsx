import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import * as apiClient from "../app/lib/api-client";
import Album from "../app/routes/album";

describe("Album", () => {
	it("groups media by year and month and previews media in place", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			items: [
				{
					id: "post-1:image-1:0",
					postId: "post-1",
					postSlug: "may-note",
					postTitle: "May note",
					category: "Journal",
					tags: ["Life"],
					kind: "image",
					url: "https://assets.233.life/assets/aa/window.jpg",
					caption: "Window light",
					publishedAt: "2026-05-03T00:00:00.000Z",
					updatedAt: "2026-05-03T00:00:00.000Z",
				},
				{
					id: "post-2:video-1:0",
					postId: "post-2",
					postSlug: "april-note",
					postTitle: "April note",
					category: null,
					tags: [],
					kind: "video",
					url: "https://assets.233.life/assets/bb/evening.mp4",
					caption: "",
					publishedAt: "2025-04-12T00:00:00.000Z",
					updatedAt: "2025-04-12T00:00:00.000Z",
				},
			],
		});

		try {
			render(
				<MemoryRouter initialEntries={["/album"]}>
					<Album />
				</MemoryRouter>,
			);

			expect(await screen.findByText("2026")).toBeTruthy();
			expect(screen.getByRole("heading", { name: "233.life" })).toBeTruthy();
			expect(screen.queryByRole("heading", { name: "Album" })).toBeNull();
			expect(screen.getByText("May")).toBeTruthy();
			expect(screen.getByText("2025")).toBeTruthy();
			expect(screen.getByText("April")).toBeTruthy();
			expect(screen.getByText("Window light")).toBeTruthy();
			expect(screen.getByText("May note")).toBeTruthy();
			expect(screen.getByText("Video")).toBeTruthy();
			expect(apiGet).toHaveBeenCalledWith("/api/album");

			fireEvent.click(
				screen.getByRole("button", { name: "Preview Window light" }),
			);

			const dialog = screen.getByRole("dialog", { name: "Media preview" });
			expect(within(dialog).getByRole("img", { name: "Window light" })).toHaveAttribute(
				"src",
				"https://assets.233.life/assets/aa/window.jpg",
			);

			fireEvent.click(within(dialog).getByRole("button", { name: "Close preview" }));
			expect(screen.queryByRole("dialog", { name: "Media preview" })).toBeNull();
		} finally {
			apiGet.mockRestore();
		}
	});
});
