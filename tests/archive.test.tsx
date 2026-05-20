import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import Archive from "../app/routes/archive";
import * as apiClient from "../app/lib/api-client";

describe("Archive", () => {
	it("groups archived posts by year and month with compact metadata", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			items: [
				{
					id: "post-1",
					slug: "may-note",
					title: "May note",
					excerpt: "Hidden from archive list",
					coverUrl: null,
					category: "Essay",
					tags: ["Life", "Notes"],
					publishedAt: "2026-05-01T00:00:00.000Z",
					updatedAt: "2026-05-02T00:00:00.000Z",
				},
				{
					id: "post-2",
					slug: "april-note",
					title: "April note",
					excerpt: "",
					coverUrl: null,
					category: "Journal",
					tags: [],
					publishedAt: "2025-04-12T00:00:00.000Z",
					updatedAt: "2025-04-13T00:00:00.000Z",
				},
			],
		});

		try {
			render(
				<MemoryRouter initialEntries={["/archive"]}>
					<Archive />
				</MemoryRouter>,
			);

			expect(await screen.findByRole("heading", { name: "Archive" })).toBeTruthy();
			expect(screen.getByRole("heading", { name: "233.life" })).toBeTruthy();
			expect(screen.getByText("2026")).toBeTruthy();
			expect(screen.getByText("2025")).toBeTruthy();
			expect(screen.getByText("May")).toBeTruthy();
			expect(screen.getByText("April")).toBeTruthy();
			expect(screen.getByRole("link", { name: "May note" })).toHaveAttribute(
				"href",
				"/post/may-note",
			);
			expect(screen.getByText("May 1, 2026")).toBeTruthy();
			expect(screen.getByText("Essay")).toBeTruthy();
			expect(screen.getByText("Life")).toBeTruthy();
			expect(screen.queryByText("Hidden from archive list")).toBeNull();
			expect(apiGet).toHaveBeenCalledWith("/api/archive");
		} finally {
			apiGet.mockRestore();
		}
	});
});
