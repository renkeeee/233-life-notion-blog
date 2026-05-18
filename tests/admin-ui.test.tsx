import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminLogin } from "../app/components/admin/AdminLogin";

describe("AdminLogin", () => {
	it("renders password login form", () => {
		render(<AdminLogin onLogin={vi.fn()} />);
		expect(screen.getByLabelText("Password")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
	});
});
