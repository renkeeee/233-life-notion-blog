import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const adminCss = readFileSync(resolve(testDirectory, "../app/app.css"), "utf8");

function cssRule(selector: string): string {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = adminCss.match(new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`));

	return match?.[1] ?? "";
}

describe("admin styles", () => {
	it("uses a single stable date-time picker input instead of segmented inputs", () => {
		const pickerRule = cssRule(".admin-date-time-picker");
		const inputRule = cssRule(".admin-date-time-input");

		expect(adminCss).not.toContain("react-datetime-picker__inputGroup");
		expect(pickerRule).toContain("width: 100%");
		expect(inputRule).toContain("width: 100%");
		expect(inputRule).toContain("min-width: 0");
	});

	it("styles the comment management page with stable list and toolbar sizing", () => {
		const settingsEntryRule = cssRule(".admin-settings-entry-card");
		const toolbarRule = cssRule(".admin-comment-toolbar");
		const tabsRule = cssRule(".admin-comment-tabs");
		const listRule = cssRule(".admin-comment-management-list");

		expect(settingsEntryRule).toContain("align-self: stretch");
		expect(toolbarRule).toContain("display: grid");
		expect(toolbarRule).toContain("gap: 1rem");
		expect(tabsRule).toContain("display: flex");
		expect(listRule).toContain("display: grid");
		expect(listRule).toContain("gap: 1rem");
	});

	it("lays out the local post editor as a writing canvas with a details rail", () => {
		const workspaceRule = cssRule(".admin-editor-workspace");
		const writingRule = cssRule(".admin-editor-writing");
		const detailsRule = cssRule(".admin-editor-details");
		const detailsCardRule = cssRule(".admin-editor-details-card");
		const mobileWorkspaceRule =
			adminCss.match(
				/@media \(max-width: 720px\) \{[\s\S]+?\.admin-editor-workspace\s*\{([^}]+)\}/,
			)?.[1] ?? "";

		expect(workspaceRule).toContain("display: grid");
		expect(workspaceRule).toContain(
			"grid-template-columns: minmax(0, 1.75fr) minmax(300px, 0.7fr)",
		);
		expect(writingRule).toContain("min-width: 0");
		expect(detailsRule).toContain("min-width: 0");
		expect(detailsCardRule).toContain("position: sticky");
		expect(mobileWorkspaceRule).toContain("grid-template-columns: 1fr");
	});

	it("keeps the MDX editor toolbar visible and scrollable inside the editor shell", () => {
		const toolbarRule = cssRule(".admin-mdx-toolbar");
		const toolbarButtonRule = cssRule(".admin-shell .admin-mdx-toolbar button");

		expect(toolbarRule).toContain("border-bottom: 1px solid var(--admin-line-soft)");
		expect(toolbarRule).toContain("overflow-x: auto");
		expect(toolbarRule).toContain("padding: 8px 10px");
		expect(toolbarButtonRule).toContain("background: transparent");
		expect(toolbarButtonRule).toContain("box-shadow: none");
	});

	it("keeps sync run ids readable and gives the detail modal room", () => {
		const runIdRule = cssRule(".admin-sync-run-button .admin-sync-run-id");
		const modalRule = cssRule(".admin-modal.admin-sync-run-modal");

		expect(runIdRule).not.toContain("transparent");
		expect(runIdRule).toContain("color: var(--admin-ink)");
		expect(modalRule).toContain("width: min(96vw, 1120px)");
		expect(modalRule).toContain("max-height: calc(100vh - 48px)");
	});
});
