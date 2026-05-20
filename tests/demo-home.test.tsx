import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "../app/App";
import * as apiClient from "../app/lib/api-client";

describe("demo homepage", () => {
	it("renders mock homepage content at /demo without loading real API data", async () => {
		window.history.pushState({}, "", "/demo");
		const apiGet = vi
			.spyOn(apiClient, "apiGet")
			.mockImplementation((path: string) => {
				if (path === "/api/turnstile/access") {
					return Promise.resolve({
						enabled: false,
						verified: true,
						siteKey: "",
					});
				}

				return Promise.reject(
					new Error("The demo route must not call the real content API"),
				);
			});

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
			).toHaveAttribute("href", "/demo/post/demo-slower-morning");
			expect(screen.getByText("7 posts")).toBeTruthy();
			expect(apiGet).toHaveBeenCalledWith("/api/turnstile/access");
			expect(apiGet).not.toHaveBeenCalledWith(
				expect.stringContaining("/api/posts"),
			);
		} finally {
			apiGet.mockRestore();
			window.history.pushState({}, "", "/");
		}
	});

	it("opens a mock detail page from the demo homepage without loading real API data", async () => {
		window.history.pushState({}, "", "/demo");
		const apiGet = vi
			.spyOn(apiClient, "apiGet")
			.mockImplementation((path: string) => {
				if (path === "/api/turnstile/access") {
					return Promise.resolve({
						enabled: false,
						verified: true,
						siteKey: "",
					});
				}

				return Promise.reject(
					new Error("The demo detail route must not call the real content API"),
				);
			});

		try {
			render(<App />);

			fireEvent.click(
				await screen.findByRole("link", {
					name: "The shape of a slower morning",
				}),
			);

			await waitFor(() =>
				expect(window.location.pathname).toBe("/demo/post/demo-slower-morning"),
			);
			expect(await screen.findByText("All demo posts")).toHaveAttribute(
				"href",
				"/demo",
			);
			expect(
				screen.getByRole("heading", {
					name: "The shape of a slower morning",
					level: 1,
				}),
			).toBeTruthy();
			expect(
				screen.getByText(
					"The morning did not ask to be optimized. It arrived with steam, light, and the small patience of an unread page.",
				),
			).toBeTruthy();
			expect(apiGet).toHaveBeenCalledWith("/api/turnstile/access");
			expect(apiGet).not.toHaveBeenCalledWith(
				expect.stringContaining("/api/posts"),
			);
		} finally {
			apiGet.mockRestore();
			window.history.pushState({}, "", "/");
		}
	});
});
