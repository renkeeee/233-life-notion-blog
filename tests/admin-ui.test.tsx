import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminLogin } from "../app/components/admin/AdminLogin";
import { SettingsPanel } from "../app/components/admin/SettingsPanel";

describe("AdminLogin", () => {
	it("renders password login form", () => {
		render(<AdminLogin onLogin={vi.fn()} />);
		expect(screen.getByLabelText("Password")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
	});
});

describe("SettingsPanel", () => {
	it("prefills the current Notion database and only renders supported mappings", () => {
		render(<SettingsPanel csrfToken="csrf-token" disabled />);

		expect(
			screen.getByDisplayValue(
				"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
			),
		).toBeTruthy();
		expect(
			screen.getByDisplayValue("3646b3023c2380fc886af37685393dd4"),
		).toBeTruthy();
		expect(screen.getByLabelText("title")).toBeTruthy();
		expect(screen.getByLabelText("status")).toBeTruthy();
		expect(screen.getByLabelText("publishedAt")).toBeTruthy();
		expect(screen.queryByLabelText("summary")).toBeNull();
		expect(screen.queryByLabelText("tags")).toBeNull();
		expect(screen.queryByLabelText("cover")).toBeNull();
	});
});
