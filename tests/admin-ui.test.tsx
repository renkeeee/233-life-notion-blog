import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminLogin } from "../app/components/admin/AdminLogin";
import { SettingsPanel } from "../app/components/admin/SettingsPanel";
import Admin, { PasswordChangePanel } from "../app/routes/admin";
import * as apiClient from "../app/lib/api-client";

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
		expect(screen.getByText("Notion type: title")).toBeTruthy();
		expect(screen.getByText("Notion type: status, select, or checkbox")).toBeTruthy();
		expect(screen.getByText("Notion type: date or created_time")).toBeTruthy();
		expect(screen.getByLabelText("Published status values")).toHaveValue(
			"Published\n已发布",
		);
		expect(screen.queryByLabelText("summary")).toBeNull();
		expect(screen.queryByLabelText("tags")).toBeNull();
		expect(screen.queryByLabelText("cover")).toBeNull();
	});

	it("tests schema with the stored token when the token field is redacted", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			siteTitle: "233 Life",
			notionDatabaseUrl:
				"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
			notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
			notionToken: "",
			hasNotionToken: true,
			cdnBaseUrl: "https://cdn.example.com",
			fieldMapping: {
				title: "Name",
				status: "Status",
				publishedAt: "Published At",
				publishedStatusValues: ["Published", "已发布"],
			},
		});
		const apiPost = vi.spyOn(apiClient, "apiPost").mockResolvedValue({
			databaseId: "3646b3023c2380fc886af37685393dd4",
			properties: {},
			recommendedFieldMapping: {},
		});
		try {
			render(<SettingsPanel csrfToken="csrf-token" />);

			await screen.findByText(
				"Settings loaded. Re-enter the Notion token when saving changes.",
			);
			fireEvent.click(screen.getByRole("button", { name: "Test schema" }));

			await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
			const [, body, csrfToken] = apiPost.mock.calls[0] ?? [];
			expect(body).toMatchObject({
				notionDatabaseUrl:
					"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
				notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
			});
			expect(body).not.toHaveProperty("notionToken");
			expect(csrfToken).toBe("csrf-token");
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
		}
	});

	it("saves settings without sending a blank redacted token", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			siteTitle: "233 Life",
			notionDatabaseUrl:
				"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
			notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
			notionToken: "",
			hasNotionToken: true,
			cdnBaseUrl: "https://cdn.example.com",
			fieldMapping: {
				title: "Name",
				status: "Status",
				publishedStatusValues: ["Published", "已发布"],
			},
		});
		const apiPut = vi.spyOn(apiClient, "apiPut").mockResolvedValue({
			siteTitle: "Updated Life",
			notionDatabaseUrl:
				"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
			notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
			notionToken: "",
			hasNotionToken: true,
			cdnBaseUrl: "https://cdn.example.com",
			fieldMapping: {
				title: "Name",
				status: "Status",
				publishedStatusValues: ["Published", "已发布"],
			},
		});
		try {
			render(<SettingsPanel csrfToken="csrf-token" />);

			await screen.findByText(
				"Settings loaded. Re-enter the Notion token when saving changes.",
			);
			fireEvent.change(screen.getByLabelText("Site title"), {
				target: { value: "Updated Life" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

			await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
			const [, body, csrfToken] = apiPut.mock.calls[0] ?? [];
			expect(body).toMatchObject({ siteTitle: "Updated Life" });
			expect(body).not.toHaveProperty("hasNotionToken");
			expect(body).not.toHaveProperty("notionToken");
			expect(csrfToken).toBe("csrf-token");
		} finally {
			apiGet.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("shows a local validation message when CDN base URL is empty", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			siteTitle: "233 Life",
			notionDatabaseUrl:
				"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
			notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
			notionToken: "",
			hasNotionToken: true,
			cdnBaseUrl: "",
			fieldMapping: {
				title: "Name",
				status: "Status",
				publishedStatusValues: ["Published", "已发布"],
			},
		});
		const apiPut = vi.spyOn(apiClient, "apiPut").mockResolvedValue({});
		try {
			render(<SettingsPanel csrfToken="csrf-token" />);

			await screen.findByText(
				"Settings loaded. Re-enter the Notion token when saving changes.",
			);
			fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

			await screen.findByText("CDN base URL is required.");
			expect(apiPut).not.toHaveBeenCalled();
		} finally {
			apiGet.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("shows schema test errors without unavailable endpoint copy", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			siteTitle: "233 Life",
			notionDatabaseUrl:
				"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
			notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
			notionToken: "",
			hasNotionToken: true,
			cdnBaseUrl: "https://cdn.example.com",
			fieldMapping: {
				title: "Name",
				status: "Status",
				publishedStatusValues: ["Published", "已发布"],
			},
		});
		const apiPost = vi
			.spyOn(apiClient, "apiPost")
			.mockRejectedValue(new Error("Notion authentication failed"));
		try {
			render(<SettingsPanel csrfToken="csrf-token" />);

			await screen.findByText(
				"Settings loaded. Re-enter the Notion token when saving changes.",
			);
			fireEvent.click(screen.getByRole("button", { name: "Test schema" }));

			await screen.findByText("Notion authentication failed");
			expect(screen.queryByText(/Schema testing endpoint is not available yet/)).toBeNull();
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
		}
	});
});

describe("PasswordChangePanel", () => {
	it("requires matching new password confirmation before submitting", async () => {
		const apiPost = vi.spyOn(apiClient, "apiPost").mockResolvedValue({ ok: true });
		try {
			render(<PasswordChangePanel csrfToken="csrf-token" onChanged={vi.fn()} />);

			expect(screen.getByLabelText("Confirm new password")).toBeTruthy();
			fireEvent.change(screen.getByLabelText("Current password"), {
				target: { value: "123456" },
			});
			fireEvent.change(screen.getByLabelText("New password"), {
				target: { value: "changed-password" },
			});
			fireEvent.change(screen.getByLabelText("Confirm new password"), {
				target: { value: "different-password" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Change password" }));

			await screen.findByText("New passwords do not match.");
			expect(apiPost).not.toHaveBeenCalled();
		} finally {
			apiPost.mockRestore();
		}
	});

	it("submits the password change when confirmation matches", async () => {
		const onChanged = vi.fn();
		const apiPost = vi.spyOn(apiClient, "apiPost").mockResolvedValue({ ok: true });
		try {
			render(<PasswordChangePanel csrfToken="csrf-token" onChanged={onChanged} />);

			fireEvent.change(screen.getByLabelText("Current password"), {
				target: { value: "123456" },
			});
			fireEvent.change(screen.getByLabelText("New password"), {
				target: { value: "changed-password" },
			});
			fireEvent.change(screen.getByLabelText("Confirm new password"), {
				target: { value: "changed-password" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Change password" }));

			await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
			expect(apiPost).toHaveBeenCalledWith(
				"/api/admin/password",
				{
					currentPassword: "123456",
					newPassword: "changed-password",
				},
				"csrf-token",
			);
		} finally {
			apiPost.mockRestore();
		}
	});
});

describe("Admin", () => {
	it("shows password change in settings instead of overview", async () => {
		const apiGet = vi
			.spyOn(apiClient, "apiGet")
			.mockImplementation(async (path: string) => {
				if (path === "/api/admin/me") {
					return {
						authenticated: true,
						csrfToken: "csrf-token",
						mustChangePassword: false,
					};
				}

				return {
					siteTitle: "233 Life",
					notionDatabaseUrl:
						"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
					notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
					notionToken: "",
					hasNotionToken: true,
					cdnBaseUrl: "https://cdn.example.com",
					fieldMapping: {
						title: "Name",
						status: "Status",
						publishedStatusValues: ["Published", "已发布"],
					},
				};
			});
		try {
			render(<Admin />);

			await screen.findByText("Operations");
			expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();

			fireEvent.click(screen.getByRole("button", { name: "Settings" }));

			expect(
				await screen.findByRole("button", { name: "Change password" }),
			).toBeTruthy();
			expect(screen.getByText("Use this form to update your admin password.")).toBeTruthy();
			expect(screen.getByText("Optional")).toBeTruthy();
		} finally {
			apiGet.mockRestore();
		}
	});
});
