import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const appTsx = readFileSync(resolve(testDirectory, "../app/App.tsx"), "utf8");
const mainTsx = readFileSync(resolve(testDirectory, "../app/main.tsx"), "utf8");
const indexHtml = readFileSync(resolve(testDirectory, "../index.html"), "utf8");

describe("frontend performance boundaries", () => {
	it("keeps non-home routes behind lazy route chunks", () => {
		expect(appTsx).toContain("lazy(");
		expect(appTsx).toContain('import("./routes/admin")');
		expect(appTsx).toContain('import("./routes/archive")');
		expect(appTsx).toContain('import("./routes/post")');
		expect(appTsx).toContain('import("./routes/search")');
		expect(appTsx).not.toContain('import Admin from "./routes/admin"');
		expect(appTsx).not.toContain('import Archive from "./routes/archive"');
		expect(appTsx).not.toContain('import Post from "./routes/post"');
		expect(appTsx).not.toContain('import Search from "./routes/search"');
	});

	it("does not load admin-only date picker styles from the public entrypoint", () => {
		expect(mainTsx).not.toContain("react-datepicker/dist/react-datepicker.css");
	});

	it("loads only the display font needed by the public identity", () => {
		expect(indexHtml).toContain("family=Cormorant+Garamond");
		expect(indexHtml).not.toContain("family=Inter");
	});
});
