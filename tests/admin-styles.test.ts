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
});
