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
	it("keeps date-time picker segment inputs from inheriting full-width form inputs", () => {
		const inputRule = cssRule(
			".admin-date-time-picker .react-datetime-picker__inputGroup__input",
		);
		const inputGroupRule = cssRule(
			".admin-date-time-picker .react-datetime-picker__inputGroup",
		);

		expect(inputRule).toContain("width: auto");
		expect(inputRule).toContain("box-sizing: content-box");
		expect(inputGroupRule).toContain("min-width: 15ch");
	});
});
