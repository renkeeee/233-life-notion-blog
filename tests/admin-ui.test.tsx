import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AdminLogin } from "../app/components/admin/AdminLogin";
import { AlbumPanel } from "../app/components/admin/AlbumPanel";
import { CommentManagementPanel } from "../app/components/admin/CommentManagementPanel";
import { PostStatusTable } from "../app/components/admin/PostStatusTable";
import { SettingsPanel } from "../app/components/admin/SettingsPanel";
import { SyncPanel } from "../app/components/admin/SyncPanel";
import Admin, { PasswordChangePanel } from "../app/routes/admin";
import * as apiClient from "../app/lib/api-client";

function LocationProbe() {
	const location = useLocation();
	return <span data-testid="admin-location">{location.pathname}</span>;
}

function renderAdmin(initialPath = "/admin/overview") {
	return render(
		<MemoryRouter initialEntries={[initialPath]}>
			<Routes>
				<Route
					path="/admin/*"
					element={
						<>
							<Admin />
							<LocationProbe />
						</>
					}
				/>
			</Routes>
		</MemoryRouter>,
	);
}

vi.mock("@mdxeditor/editor", async () => {
	const React = await import("react");

	return {
		MDXEditor: React.forwardRef(
			(
				{
					markdown,
					onChange,
					plugins = [],
					readOnly,
				}: {
					markdown: string;
					onChange: (markdown: string) => void;
					plugins?: Array<{ name?: string }>;
					readOnly?: boolean;
				},
				ref: React.ForwardedRef<{
					getMarkdown: () => string;
					setMarkdown: (value: string) => void;
				}>,
			) => {
				const [value, setValue] = React.useState(markdown);
				React.useImperativeHandle(
					ref,
					() => ({
						getMarkdown: () => value,
						setMarkdown: (nextValue: string) => setValue(nextValue),
					}),
					[value],
				);

				return (
					<>
						<div data-testid="mdx-editor-plugins">
							{plugins.map((plugin) => plugin.name).join(",")}
						</div>
						<textarea
							aria-label="Markdown"
							readOnly={readOnly}
							value={value}
							onChange={(event) => {
								setValue(event.currentTarget.value);
								onChange(event.currentTarget.value);
							}}
						/>
					</>
				);
			},
		),
		headingsPlugin: () => ({ name: "headings" }),
		imagePlugin: () => ({ name: "image" }),
		linkPlugin: () => ({ name: "link" }),
		listsPlugin: () => ({ name: "lists" }),
		markdownShortcutPlugin: () => ({ name: "markdownShortcut" }),
		quotePlugin: () => ({ name: "quote" }),
		thematicBreakPlugin: () => ({ name: "thematicBreak" }),
	};
});

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

describe("CommentManagementPanel", () => {
	const settingsResponse = {
		defaultEnabled: true,
		globalEnabled: true,
		moderationEnabled: false,
	};
	const pendingResponse = {
		items: [
			{
				id: "comment-1",
				nickname: "Ada",
				body: "A pending hello.",
				moderationStatus: "pending",
				replyBody: null,
				replyCreatedAt: null,
				createdAt: "2026-05-22T10:00:00.000Z",
				post: {
					id: "post-1",
					title: "Commented Post",
					slug: "commented-post",
					commentsEnabled: true,
				},
			},
		],
		total: 1,
		page: 1,
		limit: 20,
	};
	const approvedResponse = {
		items: [
			{
				id: "comment-2",
				nickname: "Grace",
				body: "An approved note.",
				moderationStatus: "approved",
				replyBody: "Thanks for reading.",
				replyCreatedAt: "2026-05-23T10:00:00.000Z",
				createdAt: "2026-05-21T09:00:00.000Z",
				post: {
					id: "post-2",
					title: "Quiet Post",
					slug: "quiet-post",
					commentsEnabled: false,
				},
			},
		],
		total: 1,
		page: 1,
		limit: 20,
	};

	it("loads settings and pending comments by default", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(settingsResponse);
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return Promise.resolve(pendingResponse);
			}
			throw new Error(`Unexpected GET ${path}`);
		});

		try {
			render(<CommentManagementPanel csrfToken="csrf-token" />);

			await screen.findByRole("heading", { name: "Comment management" });
			expect(screen.getByRole("button", { name: "Pending" })).toHaveClass("active");
			expect(screen.getByRole("button", { name: "Pending" })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			expect(screen.getByText("A pending hello.")).toBeTruthy();
			expect(screen.getByRole("link", { name: "Commented Post" })).toHaveAttribute(
				"href",
				"/post/commented-post",
			);
			expect(screen.getByLabelText("Allow new comments across all posts")).toBeChecked();
			expect(apiGet).toHaveBeenCalledWith(
				"/api/admin/comments?status=pending&page=1&limit=20",
			);
		} finally {
			apiGet.mockRestore();
		}
	});

	it("switches views, searches, saves settings, approves, replies, and deletes comments", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve({
					defaultEnabled: false,
					globalEnabled: false,
					moderationEnabled: true,
				});
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return Promise.resolve(pendingResponse);
			}
			if (path === "/api/admin/comments?status=approved&page=1&limit=20") {
				return Promise.resolve(approvedResponse);
			}
			if (path === "/api/admin/comments?status=all&page=1&limit=20") {
				return Promise.resolve({
					items: [],
					total: 0,
					page: 1,
					limit: 20,
				});
			}
			if (path === "/api/admin/comments?status=all&page=1&limit=20&q=Ada") {
				return Promise.resolve(pendingResponse);
			}
			throw new Error(`Unexpected GET ${path}`);
		});
		const apiPut = vi.spyOn(apiClient, "apiPut").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve({
					defaultEnabled: true,
					globalEnabled: true,
					moderationEnabled: true,
				});
			}
			if (path === "/api/admin/posts/post-1/comments/comment-1") {
				return Promise.resolve({
					comment: {
						id: "comment-1",
						nickname: "Ada",
						body: "A pending hello.",
						moderationStatus: "approved",
						replyBody: "Thanks for the note.",
						replyCreatedAt: "2026-05-23T10:00:00.000Z",
						createdAt: "2026-05-22T10:00:00.000Z",
					},
				});
			}
			throw new Error(`Unexpected PUT ${path}`);
		});
		const apiDelete = vi.spyOn(apiClient, "apiDelete").mockResolvedValue({ ok: true });

		try {
			render(<CommentManagementPanel csrfToken="csrf-token" />);

			await screen.findByText("A pending hello.");
			expect(screen.getByLabelText("Allow new comments across all posts")).not.toBeChecked();
			fireEvent.click(screen.getByLabelText("Allow new comments across all posts"));
			fireEvent.click(screen.getByLabelText("Enable comments for newly synced posts"));
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

			fireEvent.click(screen.getByRole("button", { name: "Approved" }));
			await screen.findByText("An approved note.");
			expect(apiGet).toHaveBeenCalledWith(
				"/api/admin/comments?status=approved&page=1&limit=20",
			);

			fireEvent.click(screen.getByRole("button", { name: "All" }));
			fireEvent.change(screen.getByLabelText("Search comments"), {
				target: { value: "Ada" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Search" }));
			await waitFor(() =>
				expect(apiGet).toHaveBeenCalledWith(
					"/api/admin/comments?status=all&page=1&limit=20&q=Ada",
				),
			);

			fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
			await waitFor(() =>
				expect(apiPut).toHaveBeenCalledWith(
					"/api/admin/posts/post-1/comments/comment-1",
					{ moderationStatus: "approved" },
					"csrf-token",
				),
			);

			fireEvent.change(screen.getByLabelText("Reply to Ada"), {
				target: { value: "Thanks for the note." },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save reply" }));
			await waitFor(() =>
				expect(apiPut).toHaveBeenCalledWith(
					"/api/admin/posts/post-1/comments/comment-1",
					{ replyBody: "Thanks for the note." },
					"csrf-token",
				),
			);
			expect(screen.getByLabelText("Reply to Ada")).toHaveValue(
				"Thanks for the note.",
			);
			expect(screen.getAllByText("Thanks for the note.").length).toBeGreaterThan(0);

			fireEvent.click(screen.getByRole("button", { name: "Delete" }));
			await waitFor(() =>
				expect(apiDelete).toHaveBeenCalledWith(
					"/api/admin/posts/post-1/comments/comment-1",
					"csrf-token",
				),
			);
			await waitFor(() => expect(screen.queryByText("A pending hello.")).toBeNull());
		} finally {
			apiGet.mockRestore();
			apiPut.mockRestore();
			apiDelete.mockRestore();
		}
	});

	it("keeps stale row actions disabled while a new list is loading", async () => {
		let resolveApproved: (value: typeof approvedResponse) => void = () => {};
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(settingsResponse);
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return Promise.resolve(pendingResponse);
			}
			if (path === "/api/admin/comments?status=approved&page=1&limit=20") {
				return new Promise((resolve) => {
					resolveApproved = resolve;
				});
			}
			throw new Error(`Unexpected GET ${path}`);
		});

		try {
			render(<CommentManagementPanel csrfToken="csrf-token" />);

			await screen.findByText("A pending hello.");
			fireEvent.click(screen.getByRole("button", { name: "Approved" }));

			await waitFor(() =>
				expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled(),
			);
			expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
			resolveApproved(approvedResponse);
			await screen.findByText("An approved note.");
		} finally {
			apiGet.mockRestore();
		}
	});

	it("does not let a late approval response remove the current approved list", async () => {
		let resolveApproval: (value: {
			comment: {
				id: string;
				nickname: string;
				body: string;
				moderationStatus: "approved";
				replyBody: string | null;
				replyCreatedAt: string | null;
				createdAt: string;
			};
		}) => void = () => {};
		const sameCommentApproved = {
			items: [
				{
					...pendingResponse.items[0],
					moderationStatus: "approved",
				},
			],
			total: 1,
			page: 1,
			limit: 20,
		};
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(settingsResponse);
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return Promise.resolve(pendingResponse);
			}
			if (path === "/api/admin/comments?status=approved&page=1&limit=20") {
				return Promise.resolve(sameCommentApproved);
			}
			throw new Error(`Unexpected GET ${path}`);
		});
		const apiPut = vi.spyOn(apiClient, "apiPut").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/post-1/comments/comment-1") {
				return new Promise((resolve) => {
					resolveApproval = resolve;
				});
			}
			throw new Error(`Unexpected PUT ${path}`);
		});

		try {
			render(<CommentManagementPanel csrfToken="csrf-token" />);

			await screen.findByText("A pending hello.");
			fireEvent.click(screen.getByRole("button", { name: "Approve" }));
			fireEvent.click(screen.getByRole("button", { name: "Approved" }));
			await screen.findByText("A pending hello.");

			resolveApproval({
				comment: {
					id: "comment-1",
					nickname: "Ada",
					body: "A pending hello.",
					moderationStatus: "approved",
					replyBody: null,
					replyCreatedAt: null,
					createdAt: "2026-05-22T10:00:00.000Z",
				},
			});

			await waitFor(() =>
				expect(screen.getByText("A pending hello.")).toBeTruthy(),
			);
			expect(screen.getByRole("button", { name: "Approved" })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			expect(screen.getByText("1 shown")).toBeTruthy();
			expect(screen.queryByText("No comments in this view.")).toBeNull();
		} finally {
			apiGet.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("adds a late approved comment when the approved list loaded before approval finished", async () => {
		let resolveApproval: (value: {
			comment: {
				id: string;
				nickname: string;
				body: string;
				moderationStatus: "approved";
				replyBody: string | null;
				replyCreatedAt: string | null;
				createdAt: string;
			};
		}) => void = () => {};
		const emptyApprovedResponse = {
			items: [],
			total: 0,
			page: 1,
			limit: 20,
		};
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(settingsResponse);
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return Promise.resolve(pendingResponse);
			}
			if (path === "/api/admin/comments?status=approved&page=1&limit=20") {
				return Promise.resolve(emptyApprovedResponse);
			}
			throw new Error(`Unexpected GET ${path}`);
		});
		const apiPut = vi.spyOn(apiClient, "apiPut").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/post-1/comments/comment-1") {
				return new Promise((resolve) => {
					resolveApproval = resolve;
				});
			}
			throw new Error(`Unexpected PUT ${path}`);
		});

		try {
			render(<CommentManagementPanel csrfToken="csrf-token" />);

			await screen.findByText("A pending hello.");
			fireEvent.click(screen.getByRole("button", { name: "Approve" }));
			fireEvent.click(screen.getByRole("button", { name: "Approved" }));
			await screen.findByText("No comments in this view.");

			resolveApproval({
				comment: {
					id: "comment-1",
					nickname: "Ada",
					body: "A pending hello.",
					moderationStatus: "approved",
					replyBody: null,
					replyCreatedAt: null,
					createdAt: "2026-05-22T10:00:00.000Z",
				},
			});

			await screen.findByText("A pending hello.");
			expect(screen.getByRole("button", { name: "Approved" })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			expect(screen.getByText("1 shown")).toBeTruthy();
			expect(screen.getByText("1-1 of 1 comments")).toBeTruthy();
			expect(screen.queryByText("No comments")).toBeNull();
			expect(screen.queryByText("No comments in this view.")).toBeNull();
		} finally {
			apiGet.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("uses the clicked tab for an approval that resolves before the tab fetch", async () => {
		let resolveApproval: (value: {
			comment: {
				id: string;
				nickname: string;
				body: string;
				moderationStatus: "approved";
				replyBody: string | null;
				replyCreatedAt: string | null;
				createdAt: string;
			};
		}) => void = () => {};
		let resolveApprovedList: (value: typeof approvedResponse) => void = () => {};
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(settingsResponse);
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return Promise.resolve(pendingResponse);
			}
			if (path === "/api/admin/comments?status=approved&page=1&limit=20") {
				return new Promise((resolve) => {
					resolveApprovedList = resolve;
				});
			}
			throw new Error(`Unexpected GET ${path}`);
		});
		const apiPut = vi.spyOn(apiClient, "apiPut").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/post-1/comments/comment-1") {
				return new Promise((resolve) => {
					resolveApproval = resolve;
				});
			}
			throw new Error(`Unexpected PUT ${path}`);
		});

		try {
			render(<CommentManagementPanel csrfToken="csrf-token" />);

			await screen.findByText("A pending hello.");
			fireEvent.click(screen.getByRole("button", { name: "Approve" }));
			fireEvent.click(screen.getByRole("button", { name: "Approved" }));
			resolveApproval({
				comment: {
					id: "comment-1",
					nickname: "Ada",
					body: "A pending hello.",
					moderationStatus: "approved",
					replyBody: null,
					replyCreatedAt: null,
					createdAt: "2026-05-22T10:00:00.000Z",
				},
			});

			const row = await screen.findByText("A pending hello.");
			const commentRow = row.closest("li");
			if (!commentRow) {
				throw new Error("Expected approved comment row");
			}
			await waitFor(() => expect(within(commentRow).getByText("Approved")).toBeTruthy());
			expect(screen.getByRole("button", { name: "Approved" })).toHaveAttribute(
				"aria-pressed",
				"true",
			);

			resolveApprovedList(approvedResponse);
		} finally {
			apiGet.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("does not insert a late approved comment that misses the active search", async () => {
		let resolveApproval: (value: {
			comment: {
				id: string;
				nickname: string;
				body: string;
				moderationStatus: "approved";
				replyBody: string | null;
				replyCreatedAt: string | null;
				createdAt: string;
			};
		}) => void = () => {};
		const emptyApprovedResponse = {
			items: [],
			total: 0,
			page: 1,
			limit: 20,
		};
		let resolveSearch: (value: typeof emptyApprovedResponse) => void = () => {};
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(settingsResponse);
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return Promise.resolve(pendingResponse);
			}
			if (path === "/api/admin/comments?status=approved&page=1&limit=20") {
				return Promise.resolve(emptyApprovedResponse);
			}
			if (path === "/api/admin/comments?status=approved&page=1&limit=20&q=Grace") {
				return new Promise((resolve) => {
					resolveSearch = resolve;
				});
			}
			throw new Error(`Unexpected GET ${path}`);
		});
		const apiPut = vi.spyOn(apiClient, "apiPut").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/post-1/comments/comment-1") {
				return new Promise((resolve) => {
					resolveApproval = resolve;
				});
			}
			throw new Error(`Unexpected PUT ${path}`);
		});

		try {
			render(<CommentManagementPanel csrfToken="csrf-token" />);

			await screen.findByText("A pending hello.");
			fireEvent.click(screen.getByRole("button", { name: "Approve" }));
			fireEvent.click(screen.getByRole("button", { name: "Approved" }));
			await screen.findByText("No comments in this view.");
			fireEvent.change(screen.getByLabelText("Search comments"), {
				target: { value: "Grace" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Search" }));

			resolveApproval({
				comment: {
					id: "comment-1",
					nickname: "Ada",
					body: "A pending hello.",
					moderationStatus: "approved",
					replyBody: null,
					replyCreatedAt: null,
					createdAt: "2026-05-22T10:00:00.000Z",
				},
			});

			await waitFor(() => expect(screen.queryByText("A pending hello.")).toBeNull());
			expect(screen.getByText("0 shown")).toBeTruthy();
			expect(screen.getByRole("status")).toHaveTextContent("Comment approved.");
			resolveSearch(emptyApprovedResponse);
			await screen.findByText("No comments");
			expect(screen.getByText("No comments in this view.")).toBeTruthy();
		} finally {
			apiGet.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("does not let a late delete response decrement the current approved list", async () => {
		let resolveDelete: (value: { ok: boolean }) => void = () => {};
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(settingsResponse);
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return Promise.resolve(pendingResponse);
			}
			if (path === "/api/admin/comments?status=approved&page=1&limit=20") {
				return Promise.resolve(approvedResponse);
			}
			throw new Error(`Unexpected GET ${path}`);
		});
		const apiDelete = vi.spyOn(apiClient, "apiDelete").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/post-1/comments/comment-1") {
				return new Promise((resolve) => {
					resolveDelete = resolve;
				});
			}
			throw new Error(`Unexpected DELETE ${path}`);
		});

		try {
			render(<CommentManagementPanel csrfToken="csrf-token" />);

			await screen.findByText("A pending hello.");
			fireEvent.click(screen.getByRole("button", { name: "Delete" }));
			fireEvent.click(screen.getByRole("button", { name: "Approved" }));
			await screen.findByText("An approved note.");
			expect(screen.getByText("1 shown")).toBeTruthy();

			resolveDelete({ ok: true });

			await waitFor(() =>
				expect(screen.getByText("An approved note.")).toBeTruthy(),
			);
			expect(screen.getByRole("button", { name: "Approved" })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			expect(screen.getByText("1 shown")).toBeTruthy();
			expect(screen.queryByText("0 shown")).toBeNull();
		} finally {
			apiGet.mockRestore();
			apiDelete.mockRestore();
		}
	});

	it("disables the reply textarea while that reply save is pending", async () => {
		let resolveReply: (value: {
			comment: {
				id: string;
				nickname: string;
				body: string;
				moderationStatus: "pending";
				replyBody: string;
				replyCreatedAt: string;
				createdAt: string;
			};
		}) => void = () => {};
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(settingsResponse);
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return Promise.resolve(pendingResponse);
			}
			throw new Error(`Unexpected GET ${path}`);
		});
		const apiPut = vi.spyOn(apiClient, "apiPut").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/post-1/comments/comment-1") {
				return new Promise((resolve) => {
					resolveReply = resolve;
				});
			}
			throw new Error(`Unexpected PUT ${path}`);
		});

		try {
			render(<CommentManagementPanel csrfToken="csrf-token" />);

			await screen.findByText("A pending hello.");
			fireEvent.change(screen.getByLabelText("Reply to Ada"), {
				target: { value: "Holding this thought." },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save reply" }));

			expect(screen.getByLabelText("Reply to Ada")).toBeDisabled();
			expect(screen.getByRole("button", { name: "Save reply" })).toBeDisabled();
			expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();

			resolveReply({
				comment: {
					id: "comment-1",
					nickname: "Ada",
					body: "A pending hello.",
					moderationStatus: "pending",
					replyBody: "Holding this thought.",
					replyCreatedAt: "2026-05-23T10:00:00.000Z",
					createdAt: "2026-05-22T10:00:00.000Z",
				},
			});
			await waitFor(() =>
				expect(screen.getByLabelText("Reply to Ada")).not.toBeDisabled(),
			);
		} finally {
			apiGet.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("keeps each row disabled until its own overlapping action resolves", async () => {
		let resolveFirstReply: (value: {
			comment: {
				id: string;
				nickname: string;
				body: string;
				moderationStatus: "pending";
				replyBody: string;
				replyCreatedAt: string;
				createdAt: string;
			};
		}) => void = () => {};
		let resolveSecondDelete: (value: { ok: boolean }) => void = () => {};
		const twoPendingResponse = {
			items: [
				pendingResponse.items[0],
				{
					...pendingResponse.items[0],
					id: "comment-2",
					nickname: "Lin",
					body: "Second pending hello.",
				},
			],
			total: 2,
			page: 1,
			limit: 20,
		};
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(settingsResponse);
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return Promise.resolve(twoPendingResponse);
			}
			throw new Error(`Unexpected GET ${path}`);
		});
		const apiPut = vi.spyOn(apiClient, "apiPut").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/post-1/comments/comment-1") {
				return new Promise((resolve) => {
					resolveFirstReply = resolve;
				});
			}
			throw new Error(`Unexpected PUT ${path}`);
		});
		const apiDelete = vi.spyOn(apiClient, "apiDelete").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/post-1/comments/comment-2") {
				return new Promise((resolve) => {
					resolveSecondDelete = resolve;
				});
			}
			throw new Error(`Unexpected DELETE ${path}`);
		});

		try {
			render(<CommentManagementPanel csrfToken="csrf-token" />);

			await screen.findByText("A pending hello.");
			const adaRow = screen.getByText("A pending hello.").closest("li");
			const linRow = screen.getByText("Second pending hello.").closest("li");
			if (!adaRow || !linRow) {
				throw new Error("Expected comment rows");
			}

			fireEvent.change(within(adaRow).getByLabelText("Reply to Ada"), {
				target: { value: "First reply pending." },
			});
			fireEvent.click(within(adaRow).getByRole("button", { name: "Save reply" }));
			expect(within(adaRow).getByLabelText("Reply to Ada")).toBeDisabled();

			fireEvent.click(within(linRow).getByRole("button", { name: "Delete" }));
			expect(within(adaRow).getByLabelText("Reply to Ada")).toBeDisabled();
			expect(within(adaRow).getByRole("button", { name: "Save reply" })).toBeDisabled();
			expect(within(linRow).getByRole("button", { name: "Deleting..." })).toBeDisabled();

			resolveSecondDelete({ ok: true });
			await waitFor(() =>
				expect(screen.queryByText("Second pending hello.")).toBeNull(),
			);
			expect(within(adaRow).getByLabelText("Reply to Ada")).toBeDisabled();

			resolveFirstReply({
				comment: {
					id: "comment-1",
					nickname: "Ada",
					body: "A pending hello.",
					moderationStatus: "pending",
					replyBody: "First reply pending.",
					replyCreatedAt: "2026-05-23T10:00:00.000Z",
					createdAt: "2026-05-22T10:00:00.000Z",
				},
			});
			await waitFor(() =>
				expect(within(adaRow).getByLabelText("Reply to Ada")).not.toBeDisabled(),
			);
		} finally {
			apiGet.mockRestore();
			apiPut.mockRestore();
			apiDelete.mockRestore();
		}
	});

	it("clamps to an available page after removing the last comment on a later page", async () => {
		const firstPageResponse = {
			items: [
				{
					...pendingResponse.items[0],
					id: "comment-page-1",
					body: "First page comment.",
				},
			],
			total: 21,
			page: 1,
			limit: 20,
		};
		const secondPageResponse = {
			items: [
				{
					...pendingResponse.items[0],
					id: "comment-page-2",
					body: "Last page comment.",
				},
			],
			total: 21,
			page: 2,
			limit: 20,
		};
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(settingsResponse);
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return Promise.resolve(firstPageResponse);
			}
			if (path === "/api/admin/comments?status=pending&page=2&limit=20") {
				return Promise.resolve(secondPageResponse);
			}
			throw new Error(`Unexpected GET ${path}`);
		});
		const apiDelete = vi.spyOn(apiClient, "apiDelete").mockResolvedValue({ ok: true });

		try {
			render(<CommentManagementPanel csrfToken="csrf-token" />);

			await screen.findByText("First page comment.");
			fireEvent.click(screen.getByRole("button", { name: "Next" }));
			await screen.findByText("Last page comment.");
			expect(screen.getByText("Page 2 of 2")).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Delete" }));
			await waitFor(() =>
				expect(apiDelete).toHaveBeenCalledWith(
					"/api/admin/posts/post-1/comments/comment-page-2",
					"csrf-token",
				),
			);
			await waitFor(() => expect(screen.getByText("Page 1 of 1")).toBeTruthy());
			expect(screen.queryByText("Page 2 of 1")).toBeNull();
		} finally {
			apiGet.mockRestore();
			apiDelete.mockRestore();
		}
	});
});

describe("PostStatusTable", () => {
	const commentSettingsResponse = {
		defaultEnabled: true,
		globalEnabled: true,
		moderationEnabled: false,
	};

	const emptyPostsResponse = {
		items: [],
		total: 0,
		page: 1,
		limit: 20,
	};

	const newDraftResponse = {
		draft: {
			id: "draft-1",
			postId: null,
			title: "Untitled draft",
			slug: null,
			excerpt: "",
			markdown: "",
			coverUrl: null,
			category: null,
			tags: [],
			status: "draft",
			commentsEnabled: null,
			publishedAt: null,
			createdAt: "2026-05-27T00:00:00.000Z",
			updatedAt: "2026-05-27T00:00:00.000Z",
		},
	};

	const emptyDraftsResponse = {
		items: [],
	};

	function mockPostStatusGets(response = emptyPostsResponse) {
		return vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(commentSettingsResponse);
			}
			if (path === "/api/admin/local-posts") {
				return Promise.resolve(emptyDraftsResponse);
			}

			return Promise.resolve(response);
		});
	}

	it("creates a local draft and opens the Markdown editor", async () => {
		const apiGet = mockPostStatusGets();
		const apiPost = vi
			.spyOn(apiClient, "apiPost")
			.mockResolvedValue(newDraftResponse);

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByText("No posts");
			fireEvent.click(screen.getByRole("button", { name: "New post" }));

			await screen.findByRole("heading", { name: "New local post" });
			expect(screen.getByLabelText("Title")).toHaveValue("Untitled draft");
			expect(screen.getByLabelText("Markdown")).toBeTruthy();
			expect(screen.getByTestId("mdx-editor-plugins")).toHaveTextContent("image");
			expect(apiPost).toHaveBeenCalledWith(
				"/api/admin/local-posts",
				expect.objectContaining({
					title: "Untitled draft",
					markdown: "",
				}),
				"csrf-token",
			);
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
		}
	});

	it("saves a local draft with title, slug, and markdown", async () => {
		const apiGet = mockPostStatusGets();
		const apiPost = vi
			.spyOn(apiClient, "apiPost")
			.mockResolvedValue(newDraftResponse);
		const apiPut = vi
			.spyOn(apiClient, "apiPut")
			.mockResolvedValue(newDraftResponse);

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByText("No posts");
			fireEvent.click(screen.getByRole("button", { name: "New post" }));
			await screen.findByRole("heading", { name: "New local post" });
			fireEvent.change(screen.getByLabelText("Title"), {
				target: { value: "Local Notes" },
			});
			fireEvent.change(screen.getByLabelText("Slug"), {
				target: { value: "local-notes" },
			});
			fireEvent.change(screen.getByLabelText("Markdown"), {
				target: { value: "# Local notes\n\nDraft body." },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

			await waitFor(() =>
				expect(apiPut).toHaveBeenCalledWith(
					"/api/admin/local-posts/draft-1",
					expect.objectContaining({
						title: "Local Notes",
						slug: "local-notes",
						markdown: "# Local notes\n\nDraft body.",
						commentsEnabled: null,
					}),
					"csrf-token",
				),
			);
			await screen.findByText("Draft saved.");
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("reopens a saved draft from Local drafts after backing out of the editor", async () => {
		let draftsRequestCount = 0;
		const savedDraftResponse = {
			draft: {
				...newDraftResponse.draft,
				title: "Local Notes",
				slug: "local-notes",
				markdown: "# Local notes\n\nDraft body.",
				updatedAt: "2026-05-27T00:05:00.000Z",
			},
		};
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(commentSettingsResponse);
			}
			if (path.startsWith("/api/admin/posts?")) {
				return Promise.resolve(emptyPostsResponse);
			}
			if (path === "/api/admin/local-posts") {
				draftsRequestCount += 1;
				return Promise.resolve(
					draftsRequestCount === 1
						? emptyDraftsResponse
						: { items: [savedDraftResponse.draft] },
				);
			}
			if (path === "/api/admin/local-posts/draft-1") {
				return Promise.resolve(savedDraftResponse);
			}

			return Promise.reject(new Error(`Unexpected GET ${path}`));
		});
		const apiPost = vi
			.spyOn(apiClient, "apiPost")
			.mockResolvedValue(newDraftResponse);
		const apiPut = vi
			.spyOn(apiClient, "apiPut")
			.mockResolvedValue(savedDraftResponse);

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByText("No posts");
			fireEvent.click(screen.getByRole("button", { name: "New post" }));
			await screen.findByRole("heading", { name: "New local post" });
			fireEvent.change(screen.getByLabelText("Title"), {
				target: { value: "Local Notes" },
			});
			fireEvent.change(screen.getByLabelText("Slug"), {
				target: { value: "local-notes" },
			});
			fireEvent.change(screen.getByLabelText("Markdown"), {
				target: { value: "# Local notes\n\nDraft body." },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
			await screen.findByText("Draft saved.");

			fireEvent.click(screen.getByRole("button", { name: "Back" }));
			await screen.findByRole("heading", { name: "Local drafts" });
			expect(screen.getByText("Local Notes")).toBeTruthy();

			fireEvent.click(screen.getByRole("button", { name: "Open Local Notes" }));

			await screen.findByRole("heading", { name: "New local post" });
			expect(screen.getByLabelText("Title")).toHaveValue("Local Notes");
			expect(screen.getByLabelText("Markdown")).toHaveValue(
				"# Local notes\n\nDraft body.",
			);
			expect(apiGet).toHaveBeenCalledWith("/api/admin/local-posts/draft-1");
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("disables editing controls while a draft save is in flight", async () => {
		const apiGet = mockPostStatusGets();
		const apiPost = vi
			.spyOn(apiClient, "apiPost")
			.mockResolvedValue(newDraftResponse);
		let resolveSave: (value: typeof newDraftResponse) => void = () => {};
		const apiPut = vi.spyOn(apiClient, "apiPut").mockImplementation(
			() =>
				new Promise((resolve) => {
					resolveSave = resolve;
				}),
		);

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByText("No posts");
			fireEvent.click(screen.getByRole("button", { name: "New post" }));
			await screen.findByRole("heading", { name: "New local post" });
			fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

			await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
			expect(screen.getByLabelText("Title")).toBeDisabled();
			expect(screen.getByLabelText("Slug")).toBeDisabled();
			expect(screen.getByLabelText("Published at")).toBeDisabled();
			expect(screen.getByLabelText("Summary")).toBeDisabled();
			expect(screen.getByLabelText("Category")).toBeDisabled();
			expect(screen.getByLabelText("Tags")).toBeDisabled();
			expect(screen.getByLabelText("Enable comments")).toBeDisabled();
			expect(screen.getByLabelText("Markdown")).toHaveAttribute("readonly");

			resolveSave(newDraftResponse);
			await screen.findByText("Draft saved.");
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("marks comments enabled as explicit only after the checkbox changes", async () => {
		const apiGet = mockPostStatusGets();
		const apiPost = vi
			.spyOn(apiClient, "apiPost")
			.mockResolvedValue(newDraftResponse);
		const apiPut = vi
			.spyOn(apiClient, "apiPut")
			.mockResolvedValue(newDraftResponse);

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByText("No posts");
			fireEvent.click(screen.getByRole("button", { name: "New post" }));
			await screen.findByRole("heading", { name: "New local post" });
			fireEvent.click(screen.getByLabelText("Enable comments"));
			fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

			await waitFor(() =>
				expect(apiPut).toHaveBeenCalledWith(
					"/api/admin/local-posts/draft-1",
					expect.objectContaining({
						commentsEnabled: false,
					}),
					"csrf-token",
				),
			);
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("uploads an image and inserts image markdown through the editor ref", async () => {
		const apiGet = mockPostStatusGets();
		const apiPost = vi
			.spyOn(apiClient, "apiPost")
			.mockResolvedValue(newDraftResponse);
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					asset: { url: "https://assets.example.com/assets/photo.png" },
				}),
				{
					headers: { "content-type": "application/json" },
					status: 200,
				},
			),
		);

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByText("No posts");
			fireEvent.click(screen.getByRole("button", { name: "New post" }));
			await screen.findByRole("heading", { name: "New local post" });
			fireEvent.change(screen.getByLabelText("Markdown"), {
				target: { value: "# Local notes" },
			});
			fireEvent.change(screen.getByLabelText("Upload image"), {
				target: {
					files: [new File(["image"], "photo.png", { type: "image/png" })],
				},
			});

			await screen.findByText("Image added to draft.");
			expect(fetchMock).toHaveBeenCalledWith(
				"/api/admin/uploads",
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"content-type": "image/png",
						"x-csrf-token": "csrf-token",
					}),
				}),
			);
			expect(screen.getByLabelText("Markdown")).toHaveValue(
				"# Local notes\n\n![photo](https://assets.example.com/assets/photo.png)",
			);
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
			fetchMock.mockRestore();
		}
	});

	it("publishes a saved draft, returns to the list, and refreshes posts", async () => {
		const publishedPostsResponse = {
			items: [
				{
					id: "post-1",
					title: "Local Notes",
					slug: "local-notes",
					status: "Published",
					visibility: "published",
					manualVisibility: "visible",
					locked: false,
					sourceType: "local",
					sourceId: "draft-1",
					publishedAt: "2026-05-27T00:00:00.000Z",
					notionLastEditedTime: null,
					updatedAt: "2026-05-27T00:00:00.000Z",
					lastSyncError: null,
				},
			],
			total: 1,
			page: 1,
			limit: 20,
		};
		let listRequestCount = 0;
		let draftListRequestCount = 0;
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(commentSettingsResponse);
			}
			if (path === "/api/admin/local-posts") {
				draftListRequestCount += 1;
				return Promise.resolve(emptyDraftsResponse);
			}
			if (path.startsWith("/api/admin/posts?")) {
				listRequestCount += 1;
				return Promise.resolve(
					listRequestCount === 1 ? emptyPostsResponse : publishedPostsResponse,
				);
			}

			return Promise.reject(new Error(`Unexpected GET ${path}`));
		});
		const apiPost = vi.spyOn(apiClient, "apiPost").mockImplementation((path: string) => {
			if (path === "/api/admin/local-posts") {
				return Promise.resolve(newDraftResponse);
			}
			if (path === "/api/admin/local-posts/draft-1/publish") {
				return Promise.resolve({
					draft: {
						...newDraftResponse.draft,
						postId: "post-1",
						status: "published",
					},
				});
			}

			return Promise.reject(new Error(`Unexpected POST ${path}`));
		});
		const apiPut = vi
			.spyOn(apiClient, "apiPut")
			.mockResolvedValue(newDraftResponse);

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByText("No posts");
			fireEvent.click(screen.getByRole("button", { name: "New post" }));
			await screen.findByRole("heading", { name: "New local post" });
			fireEvent.change(screen.getByLabelText("Title"), {
				target: { value: "Local Notes" },
			});
			fireEvent.change(screen.getByLabelText("Slug"), {
				target: { value: "local-notes" },
			});
			fireEvent.change(screen.getByLabelText("Markdown"), {
				target: { value: "# Local notes" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Publish" }));

			await waitFor(() =>
				expect(apiPut).toHaveBeenCalledWith(
					"/api/admin/local-posts/draft-1",
					expect.objectContaining({
						title: "Local Notes",
						slug: "local-notes",
						markdown: "# Local notes",
					}),
					"csrf-token",
				),
			);
			await waitFor(() =>
				expect(apiPost).toHaveBeenCalledWith(
					"/api/admin/local-posts/draft-1/publish",
					{},
					"csrf-token",
				),
			);
			expect(
				await screen.findByRole("link", { name: "Local Notes" }),
			).toHaveAttribute("href", "/post/local-notes");
			expect(screen.queryByRole("heading", { name: "New local post" })).toBeNull();
			expect(listRequestCount).toBeGreaterThanOrEqual(2);
			expect(draftListRequestCount).toBeGreaterThanOrEqual(2);
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
			apiPut.mockRestore();
		}
	});

	it("publishes a reopened local draft and removes it from Local drafts", async () => {
		const pendingDraft = {
			...newDraftResponse.draft,
			title: "Pending Local",
			slug: "pending-local",
			markdown: "# Pending local",
		};
		const publishedPostsResponse = {
			items: [
				{
					id: "post-1",
					title: "Pending Local",
					slug: "pending-local",
					status: "Published",
					visibility: "published",
					manualVisibility: "visible",
					locked: false,
					sourceType: "local",
					sourceId: "draft-1",
					publishedAt: "2026-05-27T00:00:00.000Z",
					notionLastEditedTime: null,
					updatedAt: "2026-05-27T00:00:00.000Z",
					lastSyncError: null,
				},
			],
			total: 1,
			page: 1,
			limit: 20,
		};
		let listRequestCount = 0;
		let draftListRequestCount = 0;
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(commentSettingsResponse);
			}
			if (path.startsWith("/api/admin/posts?")) {
				listRequestCount += 1;
				return Promise.resolve(
					listRequestCount === 1 ? emptyPostsResponse : publishedPostsResponse,
				);
			}
			if (path === "/api/admin/local-posts") {
				draftListRequestCount += 1;
				return Promise.resolve(
					draftListRequestCount === 1
						? { items: [pendingDraft] }
						: emptyDraftsResponse,
				);
			}
			if (path === "/api/admin/local-posts/draft-1") {
				return Promise.resolve({ draft: pendingDraft });
			}

			return Promise.reject(new Error(`Unexpected GET ${path}`));
		});
		const apiPost = vi.spyOn(apiClient, "apiPost").mockImplementation((path: string) => {
			if (path === "/api/admin/local-posts/draft-1/publish") {
				return Promise.resolve({
					draft: {
						...pendingDraft,
						postId: "post-1",
						status: "published",
					},
				});
			}

			return Promise.reject(new Error(`Unexpected POST ${path}`));
		});
		const apiPut = vi
			.spyOn(apiClient, "apiPut")
			.mockResolvedValue({ draft: pendingDraft });

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByRole("heading", { name: "Local drafts" });
			fireEvent.click(screen.getByRole("button", { name: "Open Pending Local" }));
			await screen.findByRole("heading", { name: "New local post" });
			fireEvent.click(screen.getByRole("button", { name: "Publish" }));

			expect(
				await screen.findByRole("link", { name: "Pending Local" }),
			).toHaveAttribute("href", "/post/pending-local");
			expect(screen.queryByRole("heading", { name: "Local drafts" })).toBeNull();
			expect(draftListRequestCount).toBeGreaterThanOrEqual(2);
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
			apiPut.mockRestore();
		}
	});

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

	it("shows local post source and hides resync for local rows", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockResolvedValue({
			items: [
				{
					id: "local-post",
					title: "Local Post",
					slug: "local-post",
					status: "Published",
					visibility: "published",
					manualVisibility: "visible",
					locked: false,
					sourceType: "local",
					sourceId: "local-post",
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
		const apiPost = vi.spyOn(apiClient, "apiPost").mockResolvedValue({});

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			await screen.findByRole("link", { name: "Local Post" });

			expect(screen.getByText("local")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Resync" })).toBeNull();
			expect(apiPost).not.toHaveBeenCalled();
		} finally {
			apiGet.mockRestore();
			apiPost.mockRestore();
		}
	});

	it("shows Edit only for local posts and opens the local editor", async () => {
		const editDraftResponse = {
			draft: {
				...newDraftResponse.draft,
				id: "existing-draft",
				postId: "local-post",
				title: "Local Post",
				slug: "local-post",
				excerpt: "Local excerpt",
				markdown: "# Existing local post",
				category: "Life",
				tags: ["local"],
				commentsEnabled: true,
				publishedAt: "2026-05-27T00:00:00.000Z",
			},
		};
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation((path: string) => {
			if (path === "/api/admin/posts/comment-settings") {
				return Promise.resolve(commentSettingsResponse);
			}
			return Promise.resolve({
				items: [
					{
						id: "local-post",
						title: "Local Post",
						slug: "local-post",
						status: "Published",
						visibility: "published",
						manualVisibility: "visible",
						locked: false,
						sourceType: "local",
						sourceId: "local-source",
						publishedAt: null,
						notionLastEditedTime: null,
						updatedAt: "2026-05-19T14:04:50.569Z",
						lastSyncError: null,
					},
					{
						id: "notion-post",
						title: "Notion Post",
						slug: "notion-post",
						status: "Published",
						visibility: "published",
						manualVisibility: "visible",
						locked: false,
						sourceType: "notion",
						sourceId: "notion-source",
						publishedAt: null,
						notionLastEditedTime: "2026-05-19T14:04:50.569Z",
						updatedAt: "2026-05-19T14:04:50.569Z",
						lastSyncError: null,
					},
				],
				total: 2,
				page: 1,
				limit: 20,
			});
		});
		const apiPost = vi
			.spyOn(apiClient, "apiPost")
			.mockResolvedValue(editDraftResponse);

		try {
			render(<PostStatusTable csrfToken="csrf-token" />);

			const localRow = (await screen.findByRole("link", {
				name: "Local Post",
			})).closest("tr");
			const notionRow = screen
				.getByRole("link", { name: "Notion Post" })
				.closest("tr");
			expect(localRow).not.toBeNull();
			expect(notionRow).not.toBeNull();
			expect(
				within(localRow as HTMLTableRowElement).getByRole("button", {
					name: "Edit",
				}),
			).toBeTruthy();
			expect(
				within(notionRow as HTMLTableRowElement).queryByRole("button", {
					name: "Edit",
				}),
			).toBeNull();

			fireEvent.click(
				within(localRow as HTMLTableRowElement).getByRole("button", {
					name: "Edit",
				}),
			);

			await screen.findByRole("heading", { name: "New local post" });
			expect(screen.getByLabelText("Title")).toHaveValue("Local Post");
			expect(screen.getByLabelText("Markdown")).toHaveValue(
				"# Existing local post",
			);
			expect(apiPost).toHaveBeenCalledWith(
				"/api/admin/local-posts",
				{ postId: "local-post" },
				"csrf-token",
			);
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
			renderAdmin("/admin");

			await screen.findByText("Overview");
			await waitFor(() =>
				expect(screen.getByTestId("admin-location")).toHaveTextContent(
					"/admin/overview",
				),
			);
			expect(screen.getByLabelText("Admin navigation")).toHaveClass(
				"admin-sidebar",
			);
			expect(screen.getByRole("link", { name: "Overview" })).toHaveClass(
				"active",
			);
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
			renderAdmin("/admin/overview");

			await screen.findByText("Operations");
			expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();

			fireEvent.click(screen.getByRole("link", { name: "Settings" }));

			expect(
				await screen.findByRole("button", { name: "Change password" }),
			).toBeTruthy();
			expect(screen.getByTestId("admin-location")).toHaveTextContent(
				"/admin/settings",
			);
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

	it("loads settings from a direct admin section path", async () => {
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
			renderAdmin("/admin/settings");

			expect(
				await screen.findByRole("button", { name: "Change password" }),
			).toBeTruthy();
			expect(screen.getByRole("link", { name: "Settings" })).toHaveClass(
				"active",
			);
			expect(screen.getByTestId("admin-location")).toHaveTextContent(
				"/admin/settings",
			);
		} finally {
			apiGet.mockRestore();
		}
	});
});
