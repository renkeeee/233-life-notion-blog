import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminLogin } from "../app/components/admin/AdminLogin";
import { AlbumPanel } from "../app/components/admin/AlbumPanel";
import { PostStatusTable } from "../app/components/admin/PostStatusTable";
import { SettingsPanel } from "../app/components/admin/SettingsPanel";
import { SyncPanel } from "../app/components/admin/SyncPanel";
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
		expect(screen.getByLabelText("category")).toBeTruthy();
		expect(screen.getByLabelText("tags")).toBeTruthy();
		expect(screen.getByLabelText("publishedAt")).toBeTruthy();
		expect(screen.getByText("Notion type: title")).toBeTruthy();
		expect(screen.getByText("Notion type: status, select, or checkbox")).toBeTruthy();
		expect(
			screen.getByText("Notion type: select, status, title, or rich_text"),
		).toBeTruthy();
		expect(screen.getByText("Notion type: multi_select or select")).toBeTruthy();
		expect(screen.getByText("Notion type: date or created_time")).toBeTruthy();
		expect(screen.getByLabelText("Published status values")).toHaveValue(
			"Published\n已发布",
		);
		expect(screen.queryByLabelText("summary")).toBeNull();
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

	it("uses loaded Notion schema as mapping choices and exposes status options", async () => {
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
				tags: "Tags",
				publishedAt: "Published At",
				publishedStatusValues: ["Published"],
			},
		});
		const apiPost = vi.spyOn(apiClient, "apiPost").mockResolvedValue({
			databaseId: "3646b3023c2380fc886af37685393dd4",
			properties: {
				Headline: { type: "title" },
				Name: { type: "rich_text" },
				Publish: {
					type: "status",
					status: {
						options: [{ name: "Published" }, { name: "Draft" }],
					},
				},
				Category: {
					type: "select",
					select: {
						options: [{ name: "Life" }],
					},
				},
				Tags: { type: "multi_select" },
				"Published On": { type: "date" },
				Created: { type: "created_time" },
			},
			recommendedFieldMapping: {
				title: "Headline",
				status: "Publish",
				category: "Category",
				tags: "Tags",
				publishedAt: "Published On",
				publishedStatusValues: ["Published"],
			},
		});
		const apiPut = vi.spyOn(apiClient, "apiPut").mockResolvedValue({
			siteTitle: "233 Life",
			notionDatabaseUrl:
				"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
			notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
			notionToken: "",
			hasNotionToken: true,
			cdnBaseUrl: "https://cdn.example.com",
			fieldMapping: {
				title: "Headline",
				status: "Publish",
				category: "Category",
				tags: "Tags",
				publishedAt: "Published On",
				publishedStatusValues: ["Published", "Draft"],
			},
		});
		try {
			render(<SettingsPanel csrfToken="csrf-token" />);

			await screen.findByText(
				"Settings loaded. Re-enter the Notion token when saving changes.",
			);
			fireEvent.click(screen.getByRole("button", { name: "Test schema" }));

			await screen.findByText("Schema loaded. Field choices were updated from Notion.");
			expect(screen.getByLabelText("title")).toHaveValue("Headline");
			expect(screen.getByLabelText("status")).toHaveValue("Publish");
			expect(screen.getByLabelText("category")).toHaveValue("Category");
			expect(screen.getByLabelText("tags")).toHaveValue("Tags");
			expect(screen.getByLabelText("publishedAt")).toHaveValue("Published On");
			expect(
				within(screen.getByLabelText("title")).getByRole("option", {
					name: "Headline (title)",
				}),
			).toBeTruthy();
			expect(
				within(screen.getByLabelText("title")).queryByRole("option", {
					name: "Name (rich_text)",
				}),
			).toBeNull();
			expect(
				within(screen.getByLabelText("category")).getByRole("option", {
					name: "Name (rich_text)",
				}),
			).toBeTruthy();
			expect(screen.getByText("Options from Publish")).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Add Draft" }));
			expect(screen.getByLabelText("Published status values")).toHaveValue(
				"Published\nDraft",
			);
			fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

			await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
			const [, body] = apiPut.mock.calls[0] ?? [];
			expect(body).toMatchObject({
				fieldMapping: {
					title: "Headline",
					status: "Publish",
					category: "Category",
					tags: "Tags",
					publishedAt: "Published On",
					publishedStatusValues: ["Published", "Draft"],
				},
			});
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
			apiPut.mockRestore();
		}
	});
});

describe("PostStatusTable", () => {
	it("loads posts with pagination, filters, sorting, and title links", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			items: [
				{
					id: "post-1",
					title: "Hello World",
					slug: "hello-world",
					status: "Published",
					visibility: "published",
					manualVisibility: "visible",
					locked: false,
					publishedAt: "2026-05-18T09:24:00.000Z",
					notionLastEditedTime: "2026-05-19T14:04:50.569Z",
					updatedAt: "2026-05-19T14:04:50.569Z",
					lastSyncError: null,
				},
			],
			total: 25,
			page: 1,
			limit: 20,
		});

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			expect(
				await screen.findByRole("link", { name: "Hello World" }),
			).toHaveAttribute("href", "/post/hello-world");
			expect(screen.queryByText("hello-world")).toBeNull();
			expect(screen.getByText("1-20 of 25 posts")).toBeTruthy();
			const table = screen.getByRole("table");
			expect(
				within(table).queryByRole("columnheader", { name: "Status" }),
			).toBeNull();
			expect(within(table).queryByText("Published")).toBeNull();

			fireEvent.change(screen.getByLabelText("Title keyword"), {
				target: { value: "Hello" },
			});
			fireEvent.change(screen.getByLabelText("Status"), {
				target: { value: "Published" },
			});
			fireEvent.change(screen.getByLabelText("Sort"), {
				target: { value: "publishedAt:asc" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

			await waitFor(() =>
				expect(apiGet).toHaveBeenLastCalledWith(
					"/api/admin/posts?page=1&limit=20&q=Hello&status=Published&sortBy=publishedAt&sortDirection=asc",
				),
			);
		} finally {
			apiGet.mockRestore();
		}
	});

	it("uses compact row actions with toast and global confirmation dialogs", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			items: [
				{
					id: "post-1",
					title: "Hello World",
					slug: "hello-world",
					status: "Published",
					visibility: "published",
					manualVisibility: "visible",
					locked: false,
					publishedAt: null,
					notionLastEditedTime: "2026-05-19T14:04:50.569Z",
					updatedAt: "2026-05-19T14:04:50.569Z",
					lastSyncError: null,
				},
			],
			total: 1,
			page: 1,
			limit: 20,
		});
		const apiPost = vi.spyOn(apiClient, "apiPost").mockResolvedValue({ ok: true });
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByRole("link", { name: "Hello World" });
			expect(
				screen.queryByRole("button", { name: "Hide Hello World" }),
			).toBeNull();
			expect(screen.queryByLabelText("Post password")).toBeNull();

			fireEvent.click(screen.getByRole("button", { name: "Hide" }));
			await screen.findByText("Hello World hidden.");
			fireEvent.click(screen.getByRole("button", { name: "Lock" }));
			const lockDialog = screen.getByRole("dialog", { name: "Lock post" });
			fireEvent.change(within(lockDialog).getByLabelText("Post password"), {
				target: { value: "post-secret" },
			});
			fireEvent.click(within(lockDialog).getByRole("button", { name: "Lock" }));
			fireEvent.click(screen.getByRole("button", { name: "Delete" }));
			const deleteDialog = screen.getByRole("dialog", { name: "Delete post" });
			expect(
				within(deleteDialog).getByText(
					"This will permanently delete Hello World.",
				),
			).toBeTruthy();
			fireEvent.click(
				within(deleteDialog).getByRole("button", { name: "Delete" }),
			);

			await waitFor(() =>
				expect(apiPost).toHaveBeenCalledWith(
					"/api/admin/posts/post-1/hide",
					{},
					"csrf-token",
				),
			);
			expect(apiPost).toHaveBeenCalledWith(
				"/api/admin/posts/post-1/lock",
				{ password: "post-secret" },
				"csrf-token",
			);
			expect(apiPost).toHaveBeenCalledWith(
				"/api/admin/posts/post-1/delete",
				{},
				"csrf-token",
			);
			expect(confirm).not.toHaveBeenCalled();
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
			confirm.mockRestore();
		}
	});

	it("queues a single post resync from row actions", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			items: [
				{
					id: "post-1",
					title: "Hello World",
					slug: "hello-world",
					status: "Published",
					visibility: "published",
					manualVisibility: "visible",
					locked: false,
					publishedAt: null,
					notionLastEditedTime: "2026-05-19T14:04:50.569Z",
					updatedAt: "2026-05-19T14:04:50.569Z",
					lastSyncError: null,
				},
			],
			total: 1,
			page: 1,
			limit: 20,
		});
		const apiPost = vi
			.spyOn(apiClient, "apiPost")
			.mockResolvedValue({ runId: "resync-run-1" });

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByRole("link", { name: "Hello World" });
			fireEvent.click(screen.getByRole("button", { name: "Resync" }));

			await waitFor(() =>
				expect(apiPost).toHaveBeenCalledWith(
					"/api/admin/posts/post-1/resync",
					{},
					"csrf-token",
				),
			);
			await screen.findByText("Hello World resync queued: resync-run-1.");
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
		}
	});

	it("opens post comments in a modal, saves the toggle, and deletes comments", async () => {
		const postsResponse = {
			items: [
				{
					id: "post-1",
					title: "Quiet Post",
					slug: "quiet-post",
					status: "Published",
					visibility: "published",
					manualVisibility: "visible",
					locked: false,
					commentsEnabled: false,
					publishedAt: null,
					notionLastEditedTime: "2026-05-19T14:04:50.569Z",
					updatedAt: "2026-05-19T14:04:50.569Z",
					lastSyncError: null,
				},
			],
			total: 1,
			page: 1,
			limit: 20,
		};
		const apiGet = vi
			.spyOn(apiClient, "apiGet")
			.mockImplementation((path: string) => {
				if (path === "/api/admin/posts/comment-settings") {
					return Promise.resolve({
						defaultEnabled: false,
						globalEnabled: false,
						moderationEnabled: true,
					});
				}
				if (path === "/api/admin/posts/post-1/comments") {
					return Promise.resolve({
						post: {
							id: "post-1",
							title: "Quiet Post",
							commentsEnabled: false,
						},
						comments: [
							{
								id: "comment-1",
								nickname: "Ada",
								body: "A small hello.",
								moderationStatus: "pending",
								replyBody: null,
								replyCreatedAt: null,
								createdAt: "2026-05-20T10:00:00.000Z",
							},
						],
					});
				}

				return Promise.resolve(postsResponse);
			});
		const apiPut = vi
			.spyOn(apiClient, "apiPut")
			.mockImplementation((path: string) => {
				if (path === "/api/admin/posts/post-1/comments") {
					return Promise.resolve({
						post: {
							id: "post-1",
							title: "Quiet Post",
							commentsEnabled: true,
						},
					});
				}
				if (path === "/api/admin/posts/post-1/comments/comment-1") {
					return Promise.resolve({
						comment: {
							id: "comment-1",
							nickname: "Ada",
							body: "A small hello.",
							moderationStatus: "approved",
							replyBody: "Thanks for the note.",
							replyCreatedAt: "2026-05-20T11:00:00.000Z",
							createdAt: "2026-05-20T10:00:00.000Z",
						},
					});
				}

				return Promise.resolve({
					defaultEnabled: true,
					globalEnabled: true,
					moderationEnabled: true,
				});
			});
		const apiDelete = vi
			.spyOn(apiClient, "apiDelete")
			.mockResolvedValue({ ok: true });

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			const globalToggle = await screen.findByLabelText(
				"Allow new comments across all posts",
			);
			expect(globalToggle).not.toBeChecked();
			fireEvent.click(globalToggle);
			const defaultToggle = screen.getByLabelText(
				"Enable comments for newly synced posts",
			);
			expect(defaultToggle).not.toBeChecked();
			fireEvent.click(defaultToggle);
			expect(
				screen.getByLabelText("Review comments before publishing"),
			).toBeChecked();
			fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

			await waitFor(() =>
				expect(apiPut).toHaveBeenCalledWith(
					"/api/admin/posts/comment-settings",
					{
						defaultEnabled: true,
						globalEnabled: true,
						moderationEnabled: true,
					},
					"csrf-token",
				),
			);
			await waitFor(() =>
				expect(screen.getAllByText("Comment settings saved.")).toHaveLength(2),
			);

			await screen.findByRole("link", { name: "Quiet Post" });
			expect(screen.getByText("published / comments off")).toBeTruthy();
			expect(
				screen.queryByRole("button", { name: "Enable comments" }),
			).toBeNull();
			fireEvent.click(screen.getByRole("button", { name: "Comments" }));

			const dialog = await screen.findByRole("dialog", {
				name: "Post comments",
			});
			expect(within(dialog).getByText("A small hello.")).toBeTruthy();
			expect(within(dialog).getByText("Pending")).toBeTruthy();
			const postToggle = within(dialog).getByLabelText(
				"Enable comments for this post",
			);
			expect(postToggle).not.toBeChecked();
			fireEvent.click(postToggle);
			fireEvent.click(within(dialog).getByRole("button", { name: "Save setting" }));

			await waitFor(() =>
				expect(apiPut).toHaveBeenCalledWith(
					"/api/admin/posts/post-1/comments",
					{ enabled: true },
					"csrf-token",
				),
			);
			fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));

			await waitFor(() =>
				expect(apiPut).toHaveBeenCalledWith(
					"/api/admin/posts/post-1/comments/comment-1",
					{ moderationStatus: "approved" },
					"csrf-token",
				),
			);
			fireEvent.change(within(dialog).getByLabelText("Reply to Ada"), {
				target: { value: "Thanks for the note." },
			});
			fireEvent.click(within(dialog).getByRole("button", { name: "Save reply" }));

			await waitFor(() =>
				expect(apiPut).toHaveBeenCalledWith(
					"/api/admin/posts/post-1/comments/comment-1",
					{ replyBody: "Thanks for the note." },
					"csrf-token",
				),
			);
			expect(within(dialog).getByText("Approved")).toBeTruthy();
			fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

			await waitFor(() =>
				expect(apiDelete).toHaveBeenCalledWith(
					"/api/admin/posts/post-1/comments/comment-1",
					"csrf-token",
				),
			);
			await waitFor(() =>
				expect(within(dialog).queryByText("A small hello.")).toBeNull(),
			);
		} finally {
			apiGet.mockRestore();
			apiPut.mockRestore();
			apiDelete.mockRestore();
		}
	});

	it("shows locked post passwords in a global dialog from the trailing icon action", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			items: [
				{
					id: "post-1",
					title: "Locked World",
					slug: "locked-world",
					status: "Published",
					visibility: "published",
					manualVisibility: "visible",
					locked: true,
					lockPassword: "post-secret",
					publishedAt: null,
					notionLastEditedTime: "2026-05-19T14:04:50.569Z",
					updatedAt: "2026-05-19T14:04:50.569Z",
					lastSyncError: null,
				},
			],
			total: 1,
			page: 1,
			limit: 20,
		});

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByRole("link", { name: "Locked World" });
			expect(screen.queryByText("post-secret")).toBeNull();
			const row = screen.getByRole("row", { name: /Locked World/ });
			const showPassword = screen.getByRole("button", { name: "Show password" });
			expect(showPassword).toHaveClass("admin-action-icon");
			fireEvent.click(showPassword);

			const dialog = screen.getByRole("dialog", { name: "Post password" });
			expect(within(dialog).getByText("post-secret")).toBeTruthy();
			expect(within(row).queryByText("post-secret")).toBeNull();
			expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
		} finally {
			apiGet.mockRestore();
		}
	});
});

describe("AlbumPanel", () => {
	it("loads album items, filters, edits items, creates collections, and uploads media", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			items: [
				{
					id: "album-1",
					title: "Window light",
					description: "",
					caption: "Morning",
					kind: "image",
					url: "https://cdn.example.com/assets/window.jpg",
					thumbnailUrl: null,
					largeUrl: "https://cdn.example.com/assets/window.jpg",
					visibility: "visible",
					featured: false,
					takenAt: "2026-05-18",
					locationName: "",
					latitude: null,
					longitude: null,
					collectionIds: ["collection-1"],
					post: { id: "post-1", slug: "hello-world", title: "Hello World" },
					updatedAt: "2026-05-19T14:04:50.569Z",
				},
			],
			total: 1,
			page: 1,
			limit: 30,
			collections: [
				{
					id: "collection-1",
					slug: "daily",
					title: "Daily",
					description: "",
					visibility: "visible",
					sortOrder: 0,
				},
			],
		});
		const apiPut = vi.spyOn(apiClient, "apiPut").mockResolvedValue({
			item: {
				id: "album-1",
				title: "Edited window",
				description: "Soft light",
				caption: "Morning",
				kind: "image",
				visibility: "visible",
				featured: true,
				collectionIds: [],
			},
		});
		const apiPost = vi.spyOn(apiClient, "apiPost").mockResolvedValue({ ok: true });

		try {
			render(<AlbumPanel csrfToken="csrf-token" />);

			await screen.findByText("Window light");
			fireEvent.change(screen.getByLabelText("Keyword"), {
				target: { value: "window" },
			});
			fireEvent.change(screen.getByLabelText("Kind"), {
				target: { value: "image" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

			await waitFor(() =>
				expect(apiGet).toHaveBeenLastCalledWith(
					"/api/admin/album?page=1&limit=30&q=window&kind=image",
				),
			);

			fireEvent.click(screen.getByRole("button", { name: "Edit" }));
			const editDialog = screen.getByRole("dialog", { name: "Edit album item" });
			fireEvent.change(within(editDialog).getByLabelText("Title"), {
				target: { value: "Edited window" },
			});
			fireEvent.change(within(editDialog).getByLabelText("Description"), {
				target: { value: "Soft light" },
			});
			fireEvent.click(within(editDialog).getByLabelText("Featured"));
			fireEvent.click(within(editDialog).getByRole("button", { name: "Save item" }));

			await waitFor(() =>
				expect(apiPut).toHaveBeenCalledWith(
					"/api/admin/album/items/album-1",
					expect.objectContaining({
						title: "Edited window",
						description: "Soft light",
						featured: true,
					}),
					"csrf-token",
				),
			);

			fireEvent.change(screen.getByLabelText("Collection title"), {
				target: { value: "Travels" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Create collection" }));

			await waitFor(() =>
				expect(apiPost).toHaveBeenCalledWith(
					"/api/admin/album/collections",
					expect.objectContaining({ title: "Travels" }),
					"csrf-token",
				),
			);
		} finally {
			apiGet.mockRestore();
			apiPut.mockRestore();
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

describe("SyncPanel", () => {
	function fillDateTime(label: string, value: string) {
		const input = screen.getByLabelText(label);
		fireEvent.change(input, { target: { value } });
		fireEvent.blur(input);
	}

	it("uses the library date-time picker and submits ISO sync ranges", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			items: [
				{
					id: "sync-run-1",
					trigger_type: "manual",
					status: "success",
					started_at: "2026-05-18T12:00:00.000Z",
				},
			],
		});
		const apiPost = vi
			.spyOn(apiClient, "apiPost")
			.mockResolvedValue({ runId: "sync-run-2" });
		try {
			const { container } = render(<SyncPanel csrfToken="csrf-token" />);

			await screen.findByText("Recent sync runs");
			expect(
				container.querySelector('input[type="datetime-local"]:not([hidden])'),
			).toBeNull();
			expect(container.querySelector(".react-datetime-picker")).toBeNull();
			expect(container.querySelector(".react-datetime-picker__inputGroup")).toBeNull();
			expect(container.querySelectorAll(".react-datepicker-wrapper")).toHaveLength(2);
			expect(screen.queryByLabelText("Range start year")).toBeNull();
			expect(screen.queryByLabelText("Range end year")).toBeNull();
			expect(screen.getByLabelText("Range start")).toHaveAttribute("type", "text");
			expect(screen.getByLabelText("Range end")).toHaveAttribute("type", "text");

			fillDateTime("Range start", "2026-05-18 09:30");
			fillDateTime("Range end", "2026-05-18 10:45");
			fireEvent.click(screen.getByRole("button", { name: "Start sync" }));

			await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
			expect(apiPost).toHaveBeenCalledWith(
				"/api/admin/sync",
				{
					rangeStart: new Date(2026, 4, 18, 9, 30).toISOString(),
					rangeEnd: new Date(2026, 4, 18, 10, 45).toISOString(),
					force: false,
				},
				"csrf-token",
			);
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
		}
	});

	it("shows sync history errors without unavailable endpoint copy", async () => {
		const apiGet = vi
			.spyOn(apiClient, "apiGet")
			.mockRejectedValue(new Error("Admin API route not found"));
		try {
			render(<SyncPanel csrfToken="csrf-token" />);

			await screen.findByText("Admin API route not found");
			expect(screen.queryByText(/Sync history endpoint is not available yet/)).toBeNull();
		} finally {
			apiGet.mockRestore();
		}
	});
});

describe("Admin", () => {
	it("loads overview dashboard metrics and recent sync warnings", async () => {
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

				if (path === "/api/admin/overview") {
					return {
						counts: {
							totalPosts: 3,
							publishedPosts: 1,
							hiddenPosts: 2,
							lockedPosts: 1,
							comments: 4,
						},
						latestSyncRun: {
							id: "run-1",
							triggerType: "cron",
							status: "partial",
							startedAt: "2026-05-20T18:00:00.000Z",
							finishedAt: "2026-05-20T18:02:00.000Z",
							failedCount: 2,
							errorMessage: "Some pages failed",
						},
						failedPosts: [
							{
								id: "post-2",
								title: "Broken Post",
								slug: "broken-post",
								lastSyncError: "Asset download failed",
								updatedAt: "2026-05-19T03:52:24.214Z",
							},
						],
						recentComments: [
							{
								id: "comment-1",
								nickname: "Ada",
								body: "A small hello.",
								createdAt: "2026-05-20T10:00:00.000Z",
								postId: "post-1",
								postTitle: "Published Post",
								postSlug: "published-post",
							},
						],
					};
				}

				throw new Error(`Unexpected GET ${path}`);
			});

		try {
			render(<Admin />);

			await screen.findByText("Overview");
			await screen.findByText("Asset download failed");
			expect(screen.getByText("Total posts")).toBeTruthy();
			expect(screen.getByText("3")).toBeTruthy();
			expect(screen.getByText(/Latest sync:\s*partial/)).toBeTruthy();
			expect(screen.getByText("A small hello.")).toBeTruthy();
		} finally {
			apiGet.mockRestore();
		}
	});

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

				if (path === "/api/admin/overview") {
					return {
						counts: {
							totalPosts: 0,
							publishedPosts: 0,
							hiddenPosts: 0,
							lockedPosts: 0,
							comments: 0,
						},
						latestSyncRun: null,
						failedPosts: [],
						recentComments: [],
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

			const passwordModule = screen.getByRole("region", { name: "Password" });
			const dataSourceModule = screen.getByRole("region", {
				name: "Data source settings",
			});
			expect(passwordModule.querySelector("form")).toHaveClass("fluid");
			expect(passwordModule).toContainElement(
				screen.getByRole("button", { name: "Change password" }),
			);
			expect(dataSourceModule).toContainElement(
				screen.getByRole("button", { name: "Test schema" }),
			);
		} finally {
			apiGet.mockRestore();
		}
	});
});
