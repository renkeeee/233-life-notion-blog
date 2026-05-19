import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../app/App";
import * as apiClient from "../app/lib/api-client";

describe("demo homepage", () => {
	it("renders mock homepage content at /demo without loading real API data", async () => {
		window.history.pushState({}, "", "/demo");
		const apiGet = vi.spyOn(apiClient, "apiGet").mockRejectedValue(
			new Error("The demo route must not call the real API"),
		);

		try {
			render(<App />);

			expect(
				await screen.findByRole("heading", {
					name: "233.life",
				}),
			).toBeTruthy();
			expect(
				screen.getByRole("heading", {
					name: "The shape of a slower morning",
				}),
			).toBeTruthy();
			expect(
				screen.getByRole("link", {
					name: "The shape of a slower morning",
				}),
			).toHaveAttribute("href", "/demo");
			expect(screen.getByText("7 posts")).toBeTruthy();
			expect(apiGet).not.toHaveBeenCalled();
		} finally {
			apiGet.mockRestore();
			window.history.pushState({}, "", "/");
		}
	});
});
