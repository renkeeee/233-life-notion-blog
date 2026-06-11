import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
					title: "Window light",
					description: "",
					postId: "post-1",
					postSlug: "may-note",
					postTitle: "May note",
					category: "Journal",
					tags: ["Life"],
					kind: "image",
					url: "https://assets.233.life/assets/aa/window.jpg",
					thumbnailUrl:
						"https://assets.233.life/cdn-cgi/image/width=440,quality=82,format=auto/assets/aa/window.jpg",
					largeUrl: "https://assets.233.life/assets/aa/window-large.jpg",
					caption: "Window light",
					takenAt: "2026-05-03T00:00:00.000Z",
					locationName: "Shanghai",
					latitude: 31.2304,
					longitude: 121.4737,
					featured: true,
					collectionSlugs: ["daily"],
					publishedAt: "2026-05-03T00:00:00.000Z",
					updatedAt: "2026-05-03T00:00:00.000Z",
				},
				{
					id: "post-2:video-1:0",
					title: "April note",
					description: "",
					postId: "post-2",
					postSlug: "april-note",
					postTitle: "April note",
					category: null,
					tags: [],
					kind: "video",
					url: "https://assets.233.life/assets/bb/evening.mp4",
					caption: "",
					takenAt: "2025-04-12T00:00:00.000Z",
					locationName: "",
					latitude: null,
					longitude: null,
					featured: false,
					collectionSlugs: [],
					publishedAt: "2025-04-12T00:00:00.000Z",
					updatedAt: "2025-04-12T00:00:00.000Z",
				},
			],
			page: 1,
			limit: 30,
			hasMore: false,
			collections: [
				{
					id: "collection-1",
					slug: "daily",
					title: "Daily",
					description: "",
					coverItemId: null,
					sortOrder: 0,
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
			expect(apiGet).toHaveBeenCalledWith("/api/album?page=1&limit=30");
			expect(screen.getByRole("img", { name: "Window light" })).toHaveAttribute(
				"src",
				"https://assets.233.life/cdn-cgi/image/width=440,quality=82,format=auto/assets/aa/window.jpg",
			);
			expect(screen.getByRole("button", { name: "Daily" })).toBeTruthy();
			expect(screen.getByRole("button", { name: "Map" })).toBeTruthy();

			fireEvent.click(
				screen.getByRole("button", { name: "Preview Window light" }),
			);

			const dialog = screen.getByRole("dialog", { name: "Media preview" });
			expect(within(dialog).getByRole("img", { name: "Window light" })).toHaveAttribute(
				"src",
				"https://assets.233.life/assets/aa/window-large.jpg",
			);

			fireEvent.click(within(dialog).getByRole("button", { name: "Close preview" }));
			expect(screen.queryByRole("dialog", { name: "Media preview" })).toBeNull();
		} finally {
			apiGet.mockRestore();
		}
	});

	it("filters album items and loads more pages", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((url) => {
			if (url === "/api/post-sections") {
				return Promise.resolve({ items: [] });
			}
			if (url === "/api/album?page=1&limit=30") {
				return Promise.resolve({
					items: [
						{
							id: "album-1",
							title: "First image",
							description: "",
							postId: null,
							postSlug: null,
							postTitle: null,
							category: null,
							tags: [],
							kind: "image",
							url: "https://assets.233.life/assets/first.jpg",
							caption: "",
							takenAt: "2026-05-03T00:00:00.000Z",
							locationName: "",
							latitude: null,
							longitude: null,
							featured: false,
							collectionSlugs: [],
							publishedAt: null,
							updatedAt: "2026-05-03T00:00:00.000Z",
						},
					],
					page: 1,
					limit: 30,
					hasMore: true,
					collections: [
						{
							id: "collection-1",
							slug: "daily",
							title: "Daily",
							description: "",
							coverItemId: null,
							sortOrder: 0,
						},
					],
				});
			}
			if (url === "/api/album?page=2&limit=30") {
				return Promise.resolve({
					items: [
						{
							id: "album-2",
							title: "Second image",
							description: "",
							postId: null,
							postSlug: null,
							postTitle: null,
							category: null,
							tags: [],
							kind: "image",
							url: "https://assets.233.life/assets/second.jpg",
							caption: "",
							takenAt: "2026-05-02T00:00:00.000Z",
							locationName: "",
							latitude: null,
							longitude: null,
							featured: false,
							collectionSlugs: [],
							publishedAt: null,
							updatedAt: "2026-05-02T00:00:00.000Z",
						},
					],
					page: 2,
					limit: 30,
					hasMore: false,
					collections: [],
				});
			}
			if (url === "/api/album?page=1&limit=30&collection=daily") {
				return Promise.resolve({
					items: [],
					page: 1,
					limit: 30,
					hasMore: false,
					collections: [],
				});
			}
			throw new Error(`Unexpected API request: ${url}`);
		});

		try {
			render(
				<MemoryRouter initialEntries={["/album"]}>
					<Album />
				</MemoryRouter>,
			);

			await screen.findByText("First image");
			fireEvent.click(screen.getByRole("button", { name: "Load more" }));
			await screen.findByText("Second image");
			expect(apiGet).toHaveBeenLastCalledWith("/api/album?page=2&limit=30");

			fireEvent.click(screen.getByRole("button", { name: "Daily" }));
			await waitFor(() =>
				expect(apiGet).toHaveBeenLastCalledWith(
					"/api/album?page=1&limit=30&collection=daily",
				),
			);
		} finally {
			apiGet.mockRestore();
		}
	});
});
