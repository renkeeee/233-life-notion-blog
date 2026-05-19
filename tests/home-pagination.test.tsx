import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as apiClient from "../app/lib/api-client";
import type { PublicPostSummary } from "../app/components/public/PostList";
import Home from "../app/routes/home";

type ObserverCallback = IntersectionObserverCallback;

const originalIntersectionObserver = globalThis.IntersectionObserver;

let observerCallback: ObserverCallback | null = null;

class TestIntersectionObserver {
	constructor(callback: ObserverCallback) {
		observerCallback = callback;
	}

	observe = vi.fn();
	disconnect = vi.fn();
	unobserve = vi.fn();
	takeRecords = vi.fn(() => []);
	root = null;
	rootMargin = "";
	thresholds = [];
}

function installIntersectionObserver() {
	globalThis.IntersectionObserver =
		TestIntersectionObserver as unknown as typeof IntersectionObserver;
}

function post(overrides: Partial<PublicPostSummary> = {}): PublicPostSummary {
	return {
		id: "post-1",
		slug: "first-post",
		title: "First post",
		coverUrl: null,
		publishedAt: "2026-05-01T00:00:00.000Z",
		updatedAt: "2026-05-01T00:00:00.000Z",
		...overrides,
	};
}

describe("home pagination", () => {
	afterEach(() => {
		globalThis.IntersectionObserver = originalIntersectionObserver;
		observerCallback = null;
		vi.restoreAllMocks();
	});

	it("loads the next posts page when the bottom sentinel enters view", async () => {
		installIntersectionObserver();
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((url) => {
			if (url === "/api/posts?page=1&limit=20") {
				return Promise.resolve({
					items: [post()],
					total: 2,
					page: 1,
					limit: 20,
				});
			}
			if (url === "/api/posts?page=2&limit=20") {
				return Promise.resolve({
					items: [
						post({
							id: "post-2",
							slug: "second-post",
							title: "Second post",
							publishedAt: "2026-05-02T00:00:00.000Z",
							updatedAt: "2026-05-02T00:00:00.000Z",
						}),
					],
					total: 2,
					page: 2,
					limit: 20,
				});
			}

			return Promise.reject(new Error(`Unexpected URL: ${url}`));
		});

		render(
			<MemoryRouter>
				<Home />
			</MemoryRouter>,
		);

		await screen.findByRole("heading", { name: "First post" });
		expect(apiGet).toHaveBeenCalledWith("/api/posts?page=1&limit=20");

		await act(async () => {
			observerCallback?.(
				[{ isIntersecting: true } as IntersectionObserverEntry],
				{} as IntersectionObserver,
			);
		});

		await screen.findByRole("heading", { name: "Second post" });
		expect(apiGet).toHaveBeenCalledWith("/api/posts?page=2&limit=20");
		await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
		expect(screen.getByText("2 posts")).toBeTruthy();
	});
});
