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
		expect(cssRule("html, body, #root")).toContain("background: #f8f7f4");
		expect(appCss).toContain("body {\n\tmin-height: 100vh;");
	});

	it("uses a literary display font for the homepage title and quiet tag button styling", () => {
		expect(cssRule(".site-title")).toContain('"Cormorant Garamond"');
		expect(cssRule(".tag-entry-button")).toContain("border: 0");
		expect(cssRule(".tag-entry-button")).toContain("color: #706d66");
	});
});
