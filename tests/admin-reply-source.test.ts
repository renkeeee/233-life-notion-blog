import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const postStatusTableSource = readFileSync(
	resolve(testDirectory, "../app/components/admin/PostStatusTable.tsx"),
	"utf8",
);

describe("admin comment reply editor", () => {
	it("does not read React event currentTarget inside the reply state updater", () => {
		expect(postStatusTableSource).not.toContain(
			"[comment.id]: event.currentTarget.value",
		);
	});
});
