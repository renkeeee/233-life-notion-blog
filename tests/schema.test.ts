import { describe, expect, it } from "vitest";
import schemaSql from "../workers/db/schema.sql?raw";

describe("D1 schema", () => {
	it("defines the tables required by the Notion blog design", () => {
		for (const table of [
			"settings",
			"posts",
			"post_content",
			"assets",
			"sync_runs",
			"sync_items",
		]) {
			expect(schemaSql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
		}
	});
});
