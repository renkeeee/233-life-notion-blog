import { render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import Home from "../app/routes/home";
import * as apiClient from "../app/lib/api-client";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(testDirectory, "../app/app.css"), "utf8");
const indexHtml = readFileSync(resolve(testDirectory, "../index.html"), "utf8");
const faviconSvgPath = resolve(testDirectory, "../public/favicon.svg");
const faviconIcoPath = resolve(testDirectory, "../public/favicon.ico");

function cssRule(selector: string): string {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = appCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`));

	return match?.[1] ?? "";
}

describe("public brand", () => {
	it("renders the 233.life identity and quiet-life slogan on the homepage", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			items: [],
			total: 0,
			page: 1,
			limit: 20,
		});
		try {
			render(
				<MemoryRouter>
					<Home />
				</MemoryRouter>,
			);

			expect(screen.getByText("Life, written in quiet moments.")).toHaveClass(
				"eyebrow",
			);
			expect(
				screen.getByRole("heading", {
					name: "233.life",
				}),
			).toBeTruthy();
			expect(screen.queryByText("Public blog")).toBeNull();
			expect(screen.queryByText("Latest posts")).toBeNull();
			await screen.findByText("No posts have been published yet.");
		} finally {
			apiGet.mockRestore();
		}
	});

	it("sets the public favicon and document title to 233.life", () => {
		expect(indexHtml).toContain("<title>233.life</title>");
		expect(indexHtml).toContain("family=Cormorant+Garamond");
		expect(indexHtml).toContain(
			'<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=20260519" />',
		);
		expect(indexHtml).not.toContain("favicon.ico");
		expect(existsSync(faviconSvgPath)).toBe(true);
		expect(existsSync(faviconIcoPath)).toBe(true);
	});

	it("applies the public page background to the full viewport", () => {
		expect(appCss).toContain("--page-bg: #f8f7f4");
		expect(cssRule("html, body, #root")).toContain(
			"background: var(--page-bg)",
		);
		expect(appCss).toContain("body {\n\tmin-height: 100vh;");
	});

	it("uses a literary display font for the homepage title and quiet tag button styling", () => {
		expect(cssRule(".site-title")).toContain('"Cormorant Garamond"');
		expect(appCss).toContain(".public-shell .tag-entry-button");
		expect(appCss).toContain("border: 0");
		expect(appCss).toContain("color: var(--muted)");
	});

	it("defines light, dark, and automatic theme variables", () => {
		expect(appCss).toContain(':root[data-theme="light"]');
		expect(appCss).toContain(':root[data-theme="dark"]');
		expect(appCss).toContain("@media (prefers-color-scheme: dark)");
		expect(appCss).toContain("--page-bg: #12110f");
	});

	it("gives the post detail back button a subtle outline", () => {
		expect(cssRule(".post-back-button")).toContain(
			"border: 1px solid var(--border)",
		);
	});

	it("keeps the category switcher on one line while it expands", () => {
		const categoryListRule = cssRule(".category-list");

		expect(categoryListRule).toContain("flex-wrap: nowrap");
		expect(categoryListRule).toContain("overflow-x: auto");
		expect(categoryListRule).toContain("overflow-y: hidden");
		expect(categoryListRule).not.toContain("flex-wrap: wrap");
	});

	it("keeps archive and album date headings compact", () => {
		expect(cssRule(".archive-year h3")).toContain(
			"font-size: clamp(1.45rem, 3vw, 2rem)",
		);
		expect(cssRule(".archive-month-label")).toContain(
			"font-size: clamp(1.05rem, 2vw, 1.25rem)",
		);
	});

	it("uses a lighter split header layout", () => {
		expect(cssRule(".public-header-brand-area")).toContain("display: flex");
		expect(cssRule(".public-header-spacer")).toContain("flex: 1 1 auto");
		expect(cssRule(".home-content-toolbar")).toContain("display: flex");
		expect(cssRule(".home-filter-actions")).toContain("justify-content: flex-end");
		expect(cssRule(".site-title")).toContain("font-weight: 600");
		expect(appCss).toContain(".public-shell .home-entry-button");
		expect(appCss).toContain("font-weight: 520");
	});

	it("differentiates the homepage category and tag filter buttons from navigation", () => {
		const filterButtonRule = cssRule(
			".home-filter-actions :is(.category-entry-button, .tag-entry-button)",
		);
		const filterHoverRule = cssRule(
			".home-filter-actions :is(.category-entry-button, .tag-entry-button):hover",
		);

		expect(filterButtonRule).toContain("font-style: italic");
		expect(filterButtonRule).toContain("font-weight: 380");
		expect(filterHoverRule).toContain("background: transparent");
		expect(filterHoverRule).toContain("color: var(--heading)");
		expect(filterHoverRule).toContain("font-weight: 620");
	});
});
