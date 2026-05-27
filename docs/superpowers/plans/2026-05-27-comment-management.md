# Comment Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `/admin/comments` page with comment settings, full-site comment filtering, approval, replies, and deletion.

**Architecture:** Add one full-site admin comments list endpoint and reuse the existing post-scoped mutation endpoints for approve, reply, and delete. Add a focused `CommentManagementPanel` React component for the new page, then wire it into the existing admin routes, sidebar, and settings page entry. Keep `PostStatusTable` comment behavior intact.

**Tech Stack:** Cloudflare Worker API, D1 SQL, React 19, React Router, Vitest, Testing Library, existing admin CSS.

---

## File Structure

- Modify `workers/api/admin.ts`: add request parsing, response mapping, SQL query, and route handling for `GET /api/admin/comments`.
- Modify `tests/sync.test.ts`: cover full-site comments API authentication, filtering, search, pagination, and post metadata.
- Create `app/components/admin/CommentManagementPanel.tsx`: new focused admin page for settings and full-site comment actions.
- Modify `tests/admin-ui.test.tsx`: test the new component, settings entry, sidebar link, and route.
- Modify `app/components/admin/AdminShell.tsx`: add `comments` to admin section types and the Settings navigation group.
- Modify `app/routes/admin.tsx`: import the new panel, add `/admin/comments`, and add a settings-page entry card.
- Modify `app/app.css`: add small, scoped styles for the settings entry and comment management list.
- Modify `tests/admin-styles.test.ts`: assert the new CSS selectors have stable layout constraints.

## Task 1: Add Full-Site Admin Comments API

**Files:**
- Modify: `tests/sync.test.ts`
- Modify: `workers/api/admin.ts`

- [ ] **Step 1: Write failing API tests**

Append these tests inside the existing admin API describe block in `tests/sync.test.ts`, near the existing post-scoped comment tests:

```ts
	it("lists full-site comments with status filters, search, pagination, and post metadata", async () => {
		const db = new SqliteD1Database();
		try {
			await seedChangedPassword(db);
			db.exec(
				`INSERT INTO posts (
					id, notion_page_id, slug, title, cover_url, status, visibility,
					published_at, notion_last_edited_time, content_hash,
					last_sync_error, created_at, updated_at, comments_enabled
				)
				VALUES
				(
					'post-1', 'notion-page-1', 'commented-post', 'Commented Post',
					NULL, 'Published', 'published', '2026-05-19T02:00:00.000Z',
					'2026-05-19T03:44:00.000Z', 'content-hash-1', NULL,
					'2026-05-19T03:41:00.000Z', '2026-05-19T03:51:24.214Z', 1
				),
				(
					'post-2', 'notion-page-2', 'quiet-post', 'Quiet Post',
					NULL, 'Published', 'published', '2026-05-20T02:00:00.000Z',
					'2026-05-20T03:44:00.000Z', 'content-hash-2', NULL,
					'2026-05-20T03:41:00.000Z', '2026-05-20T03:51:24.214Z', 0
				)`,
			);
			db.exec(
				`INSERT INTO post_comments (
					id, post_id, nickname, body, moderation_status,
					reply_body, reply_created_at, created_at
				)
				VALUES
				(
					'comment-1', 'post-1', 'Ada', 'A pending hello.', 'pending',
					NULL, NULL, '2026-05-22T10:00:00.000Z'
				),
				(
					'comment-2', 'post-2', 'Grace', 'An approved quiet note.', 'approved',
					'Thanks for reading.', '2026-05-23T10:00:00.000Z',
					'2026-05-21T09:00:00.000Z'
				),
				(
					'comment-3', 'post-1', 'Linus', 'Another pending thought.', 'pending',
					NULL, NULL, '2026-05-20T08:00:00.000Z'
				)`,
			);
			const env = envWithDb(db);
			const session = await loginSession(env);
			const cookieHeaders = { cookie: session.cookie };

			const pending = await handleAdminApi(
				adminRequest("/api/admin/comments", {
					headers: cookieHeaders,
					method: "GET",
				}),
				env,
			);
			const approved = await handleAdminApi(
				adminRequest("/api/admin/comments?status=approved", {
					headers: cookieHeaders,
					method: "GET",
				}),
				env,
			);
			const searched = await handleAdminApi(
				adminRequest("/api/admin/comments?status=all&q=quiet&page=1&limit=5", {
					headers: cookieHeaders,
					method: "GET",
				}),
				env,
			);
			const secondPage = await handleAdminApi(
				adminRequest("/api/admin/comments?status=all&page=2&limit=2", {
					headers: cookieHeaders,
					method: "GET",
				}),
				env,
			);

			expect(pending.status).toBe(200);
			await expect(pending.json()).resolves.toEqual({
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
					{
						id: "comment-3",
						nickname: "Linus",
						body: "Another pending thought.",
						moderationStatus: "pending",
						replyBody: null,
						replyCreatedAt: null,
						createdAt: "2026-05-20T08:00:00.000Z",
						post: {
							id: "post-1",
							title: "Commented Post",
							slug: "commented-post",
							commentsEnabled: true,
						},
					},
				],
				total: 2,
				page: 1,
				limit: 20,
			});
			expect(approved.status).toBe(200);
			await expect(approved.json()).resolves.toMatchObject({
				items: [
					{
						id: "comment-2",
						moderationStatus: "approved",
						replyBody: "Thanks for reading.",
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
			});
			expect(searched.status).toBe(200);
			await expect(searched.json()).resolves.toMatchObject({
				items: [{ id: "comment-2" }],
				total: 1,
				page: 1,
				limit: 5,
			});
			expect(secondPage.status).toBe(200);
			await expect(secondPage.json()).resolves.toMatchObject({
				items: [{ id: "comment-3" }],
				total: 3,
				page: 2,
				limit: 2,
			});
		} finally {
			db.close();
		}
	});

	it("protects the full-site comments endpoint with admin session and changed password", async () => {
		const unauthenticatedDb = new SqliteD1Database();
		const bootstrapDb = new SqliteD1Database();
		try {
			await seedChangedPassword(unauthenticatedDb);
			const unauthenticated = await handleAdminApi(
				adminRequest("/api/admin/comments", { method: "GET" }),
				envWithDb(unauthenticatedDb),
			);

			bootstrapDb.insertSetting({
				key: "adminPasswordHash",
				value: await hashPassword("123456"),
				encrypted: 0,
				updated_at: fixedNow,
			});
			const bootstrapEnv = envWithDb(bootstrapDb);
			const login = await handleAdminApi(
				adminRequest("/api/admin/login", {
					body: JSON.stringify({ password: "123456" }),
					headers: { "content-type": "application/json" },
					method: "POST",
				}),
				bootstrapEnv,
			);
			const bootstrapCookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
			const passwordRequired = await handleAdminApi(
				adminRequest("/api/admin/comments", {
					headers: { cookie: bootstrapCookie },
					method: "GET",
				}),
				bootstrapEnv,
			);

			expect(unauthenticated.status).toBe(401);
			await expect(unauthenticated.json()).resolves.toEqual({
				error: { code: "UNAUTHORIZED", message: "Authentication required" },
			});
			expect(passwordRequired.status).toBe(403);
			await expect(passwordRequired.json()).resolves.toEqual({
				error: { code: "FORBIDDEN", message: "Password change required" },
			});
		} finally {
			unauthenticatedDb.close();
			bootstrapDb.close();
		}
	});
```

- [ ] **Step 2: Run tests and verify the route is missing**

Run:

```bash
npm test -- tests/sync.test.ts
```

Expected: the new API tests fail with `Admin API route not found` for `/api/admin/comments`.

- [ ] **Step 3: Add backend types and query helpers**

In `workers/api/admin.ts`, add this type near `AdminOverviewCommentRow`:

```ts
type AdminCommentListRow = {
	id: string;
	nickname: string;
	body: string;
	moderation_status: "pending" | "approved";
	reply_body: string | null;
	reply_created_at: string | null;
	created_at: string;
	post_id: string;
	post_title: string;
	post_slug: string;
	post_comments_enabled: number;
};

type AdminCommentStatusFilter = "pending" | "approved" | "all";
```

Add these helpers near `parseAdminPostsPagination`:

```ts
function parseAdminCommentsPagination(params: URLSearchParams): {
	page: number;
	limit: number;
} | null {
	const page = params.get("page") ?? "1";
	const limit = params.get("limit") ?? "20";

	if (!/^[1-9]\d*$/.test(page) || !/^[1-9]\d*$/.test(limit)) {
		return null;
	}

	return {
		page: Number(page),
		limit: Math.min(Number(limit), 100),
	};
}

function adminCommentsStatus(params: URLSearchParams): AdminCommentStatusFilter | null {
	const status = params.get("status") ?? "pending";

	if (status === "pending" || status === "approved" || status === "all") {
		return status;
	}

	return null;
}

function likePattern(value: string): string {
	return `%${value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function adminCommentsFilters(params: URLSearchParams): {
	where: string;
	values: unknown[];
	status: AdminCommentStatusFilter;
	q: string;
} | null {
	const status = adminCommentsStatus(params);
	if (!status) {
		return null;
	}

	const clauses: string[] = [];
	const values: unknown[] = [];
	const q = (params.get("q") ?? "").trim();

	if (status !== "all") {
		clauses.push("pc.moderation_status = ?");
		values.push(status);
	}

	if (q) {
		clauses.push(
			"(pc.body LIKE ? ESCAPE '\\' OR pc.nickname LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\')",
		);
		const pattern = likePattern(q);
		values.push(pattern, pattern, pattern);
	}

	return {
		where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
		values,
		status,
		q,
	};
}

function adminCommentListResponse(row: AdminCommentListRow) {
	return {
		id: row.id,
		nickname: row.nickname,
		body: row.body,
		moderationStatus: row.moderation_status,
		replyBody: row.reply_body,
		replyCreatedAt: row.reply_created_at,
		createdAt: row.created_at,
		post: {
			id: row.post_id,
			title: row.post_title,
			slug: row.post_slug,
			commentsEnabled: row.post_comments_enabled === 1,
		},
	};
}
```

If `adminPostsFilters` still has its inline LIKE escaping, replace that line with `const pattern = likePattern(q);` and keep its two `values.push(pattern, pattern);` call.

- [ ] **Step 4: Implement `handleListAdminComments`**

Add this function before `handleGetPostCommentSettings`:

```ts
async function handleListAdminComments(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	try {
		const url = new URL(request.url);
		const pagination = parseAdminCommentsPagination(url.searchParams);
		if (!pagination) {
			return errorJson("BAD_REQUEST", "Invalid pagination", 400);
		}
		const filters = adminCommentsFilters(url.searchParams);
		if (!filters) {
			return errorJson("BAD_REQUEST", "Invalid comment status", 400);
		}

		const offset = (pagination.page - 1) * pagination.limit;
		const result = await env.DB.prepare(
			`SELECT
				pc.id,
				pc.nickname,
				pc.body,
				pc.moderation_status,
				pc.reply_body,
				pc.reply_created_at,
				pc.created_at,
				p.id AS post_id,
				p.title AS post_title,
				p.slug AS post_slug,
				p.comments_enabled AS post_comments_enabled
			 FROM post_comments pc
			 JOIN posts p ON p.id = pc.post_id
			 ${filters.where}
			 ORDER BY pc.created_at DESC
			 LIMIT ? OFFSET ?`,
		)
			.bind(...filters.values, pagination.limit, offset)
			.all<AdminCommentListRow>();
		const countRow = await env.DB.prepare(
			`SELECT COUNT(*) AS total
			 FROM post_comments pc
			 JOIN posts p ON p.id = pc.post_id
			 ${filters.where}`,
		)
			.bind(...filters.values)
			.first<{ total: number }>();

		return json({
			items: result.results.map(adminCommentListResponse),
			total: Number(countRow?.total ?? 0),
			page: pagination.page,
			limit: pagination.limit,
		});
	} catch {
		return errorJson("INTERNAL_ERROR", "Comments could not be loaded", 500);
	}
}
```

- [ ] **Step 5: Wire the route**

In `handleAdminApi`, add this route before the post-scoped comment routes:

```ts
	if (url.pathname === "/api/admin/comments" && request.method === "GET") {
		return handleListAdminComments(request, env);
	}
```

- [ ] **Step 6: Run backend tests**

Run:

```bash
npm test -- tests/sync.test.ts
```

Expected: all tests in `tests/sync.test.ts` pass.

- [ ] **Step 7: Commit backend API**

Run:

```bash
git add workers/api/admin.ts tests/sync.test.ts
git commit -m "Add admin comments list API"
```

## Task 2: Build Comment Management Panel

**Files:**
- Create: `app/components/admin/CommentManagementPanel.tsx`
- Modify: `tests/admin-ui.test.tsx`

- [ ] **Step 1: Add the component import and failing UI tests**

In `tests/admin-ui.test.tsx`, add:

```ts
import { CommentManagementPanel } from "../app/components/admin/CommentManagementPanel";
```

Add this describe block before `describe("PostStatusTable", () => {`:

```ts
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
			expect(screen.getByText("Thanks for the note.")).toBeTruthy();

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
});
```

- [ ] **Step 2: Run UI tests and verify the component is missing**

Run:

```bash
npm test -- tests/admin-ui.test.tsx
```

Expected: the test suite fails because `CommentManagementPanel` cannot be resolved.

- [ ] **Step 3: Create `CommentManagementPanel.tsx`**

Create `app/components/admin/CommentManagementPanel.tsx` with this content:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { apiDelete, apiGet, apiPut } from "../../lib/api-client";

type CommentStatusFilter = "pending" | "approved" | "all";

type CommentSettingsResponse = {
	defaultEnabled: boolean;
	globalEnabled: boolean;
	moderationEnabled?: boolean;
};

type AdminComment = {
	id: string;
	nickname: string;
	body: string;
	moderationStatus: "pending" | "approved";
	replyBody: string | null;
	replyCreatedAt: string | null;
	createdAt: string;
	post: {
		id: string;
		title: string;
		slug: string;
		commentsEnabled: boolean;
	};
};

type AdminCommentsResponse = {
	items: AdminComment[];
	total: number;
	page: number;
	limit: number;
};

const pageSize = 20;
const commentViews: Array<{ id: CommentStatusFilter; label: string }> = [
	{ id: "pending", label: "Pending" },
	{ id: "approved", label: "Approved" },
	{ id: "all", label: "All" },
];

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

function formatCommentDate(value: string | null): string {
	if (!value) {
		return "-";
	}

	return new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

function commentsPath({
	page,
	query,
	status,
}: {
	page: number;
	query: string;
	status: CommentStatusFilter;
}): string {
	const params = new URLSearchParams();
	params.set("status", status);
	params.set("page", String(page));
	params.set("limit", String(pageSize));
	if (query.trim()) {
		params.set("q", query.trim());
	}

	return `/api/admin/comments?${params.toString()}`;
}

function postHref(comment: AdminComment): string {
	return comment.post.slug ? `/post/${encodeURIComponent(comment.post.slug)}` : "#";
}

function visibleCommentAfterUpdate(
	currentStatus: CommentStatusFilter,
	comment: AdminComment,
): boolean {
	return currentStatus === "all" || comment.moderationStatus === currentStatus;
}

export function CommentManagementPanel({ csrfToken }: { csrfToken: string }) {
	const [globalCommentsEnabled, setGlobalCommentsEnabled] = useState(true);
	const [defaultCommentsEnabled, setDefaultCommentsEnabled] = useState(true);
	const [moderationCommentsEnabled, setModerationCommentsEnabled] =
		useState(false);
	const [settingsStatus, setSettingsStatus] = useState("Loading comment settings...");
	const [settingsPending, setSettingsPending] = useState(false);
	const [comments, setComments] = useState<AdminComment[]>([]);
	const [commentsStatus, setCommentsStatus] = useState<CommentStatusFilter>("pending");
	const [query, setQuery] = useState("");
	const [appliedQuery, setAppliedQuery] = useState("");
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [listStatus, setListStatus] = useState("Loading comments...");
	const [listError, setListError] = useState<string | null>(null);
	const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
	const [actionPending, setActionPending] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);

	const pageCount = useMemo(
		() => Math.max(1, Math.ceil(total / pageSize)),
		[total],
	);

	useEffect(() => {
		let cancelled = false;
		setSettingsStatus("Loading comment settings...");

		apiGet<CommentSettingsResponse>("/api/admin/posts/comment-settings")
			.then((response) => {
				if (cancelled) {
					return;
				}

				setGlobalCommentsEnabled(response.globalEnabled);
				setDefaultCommentsEnabled(response.defaultEnabled);
				setModerationCommentsEnabled(response.moderationEnabled === true);
				setSettingsStatus("Comment settings loaded.");
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setSettingsStatus(errorMessage(error, "Comment settings could not be loaded."));
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		setListStatus("Loading comments...");
		setListError(null);

		apiGet<AdminCommentsResponse>(
			commentsPath({ page, query: appliedQuery, status: commentsStatus }),
		)
			.then((response) => {
				if (cancelled) {
					return;
				}

				setComments(response.items);
				setTotal(response.total);
				setReplyDrafts(
					Object.fromEntries(
						response.items.map((comment) => [comment.id, comment.replyBody ?? ""]),
					),
				);
				setListStatus(
					response.total === 0
						? "No comments"
						: `${(response.page - 1) * response.limit + 1}-${Math.min(
								response.page * response.limit,
								response.total,
							)} of ${response.total} comments`,
				);
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setComments([]);
					setTotal(0);
					setListStatus("Comments could not be loaded.");
					setListError(errorMessage(error, "Comments could not be loaded."));
				}
			});

		return () => {
			cancelled = true;
		};
	}, [appliedQuery, commentsStatus, page]);

	useEffect(() => {
		if (!toast) {
			return;
		}

		const timeoutId = window.setTimeout(() => setToast(null), 3000);
		return () => window.clearTimeout(timeoutId);
	}, [toast]);

	async function saveCommentSettings() {
		setSettingsPending(true);
		setSettingsStatus("Saving comment settings...");
		try {
			const response = await apiPut<CommentSettingsResponse>(
				"/api/admin/posts/comment-settings",
				{
					defaultEnabled: defaultCommentsEnabled,
					globalEnabled: globalCommentsEnabled,
					moderationEnabled: moderationCommentsEnabled,
				},
				csrfToken,
			);
			setGlobalCommentsEnabled(response.globalEnabled);
			setDefaultCommentsEnabled(response.defaultEnabled);
			setModerationCommentsEnabled(response.moderationEnabled === true);
			setSettingsStatus("Comment settings saved.");
			setToast("Comment settings saved.");
		} catch (error) {
			setSettingsStatus(errorMessage(error, "Comment settings could not be saved."));
		} finally {
			setSettingsPending(false);
		}
	}

	function switchStatus(nextStatus: CommentStatusFilter) {
		setCommentsStatus(nextStatus);
		setPage(1);
	}

	function search(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setAppliedQuery(query);
		setPage(1);
	}

	function replaceComment(comment: AdminComment) {
		setComments((current) => {
			if (!visibleCommentAfterUpdate(commentsStatus, comment)) {
				return current.filter((item) => item.id !== comment.id);
			}

			return current.map((item) => (item.id === comment.id ? comment : item));
		});
		setReplyDrafts((current) => ({
			...current,
			[comment.id]: comment.replyBody ?? "",
		}));
	}

	function commentFromUpdate(
		current: AdminComment,
		update: Omit<AdminComment, "post">,
	): AdminComment {
		return {
			...current,
			...update,
			post: current.post,
		};
	}

	async function updateComment(
		comment: AdminComment,
		body: { moderationStatus?: "pending" | "approved"; replyBody?: string | null },
		successMessage: string,
	) {
		setActionPending(`${comment.id}:${Object.keys(body).join(",")}`);
		setListError(null);
		try {
			const response = await apiPut<{ comment: Omit<AdminComment, "post"> }>(
				`/api/admin/posts/${encodeURIComponent(comment.post.id)}/comments/${encodeURIComponent(
					comment.id,
				)}`,
				body,
				csrfToken,
			);
			replaceComment(commentFromUpdate(comment, response.comment));
			if (
				commentsStatus === "pending" &&
				body.moderationStatus === "approved"
			) {
				setTotal((current) => Math.max(0, current - 1));
			}
			setToast(successMessage);
		} catch (error) {
			setListError(errorMessage(error, "Comment could not be updated."));
		} finally {
			setActionPending(null);
		}
	}

	async function deleteComment(comment: AdminComment) {
		setActionPending(`${comment.id}:delete`);
		setListError(null);
		try {
			await apiDelete(
				`/api/admin/posts/${encodeURIComponent(comment.post.id)}/comments/${encodeURIComponent(
					comment.id,
				)}`,
				csrfToken,
			);
			setComments((current) => current.filter((item) => item.id !== comment.id));
			setTotal((current) => Math.max(0, current - 1));
			setToast("Comment deleted.");
		} catch (error) {
			setListError(errorMessage(error, "Comment could not be deleted."));
		} finally {
			setActionPending(null);
		}
	}

	return (
		<div className="admin-stack admin-comment-management">
			<div className="admin-section-heading">
				<div>
					<h2>Comment management</h2>
					<p className="admin-note">
						Review, reply to, delete, and configure visitor comments.
					</p>
				</div>
				<span className="admin-badge">{total} shown</span>
			</div>

			<section className="admin-module admin-comment-settings">
				<div className="admin-section-heading compact">
					<h3>Comment settings</h3>
					<span className="admin-badge">Global</span>
				</div>
				<label className="admin-checkbox-row">
					<input
						type="checkbox"
						checked={globalCommentsEnabled}
						onChange={(event) =>
							setGlobalCommentsEnabled(event.currentTarget.checked)
						}
					/>
					Allow new comments across all posts
				</label>
				<label className="admin-checkbox-row">
					<input
						type="checkbox"
						checked={defaultCommentsEnabled}
						onChange={(event) =>
							setDefaultCommentsEnabled(event.currentTarget.checked)
						}
					/>
					Enable comments for newly synced posts
				</label>
				<label className="admin-checkbox-row">
					<input
						type="checkbox"
						checked={moderationCommentsEnabled}
						onChange={(event) =>
							setModerationCommentsEnabled(event.currentTarget.checked)
						}
					/>
					Review comments before publishing
				</label>
				<div className="admin-inline-actions">
					<button
						type="button"
						disabled={settingsPending}
						onClick={saveCommentSettings}
					>
						{settingsPending ? "Saving..." : "Save settings"}
					</button>
					<span>{settingsStatus}</span>
				</div>
			</section>

			<section className="admin-module admin-comment-list-module">
				<div className="admin-comment-toolbar">
					<div className="admin-comment-tabs" role="group" aria-label="Comment status">
						{commentViews.map((view) => (
							<button
								type="button"
								key={view.id}
								className={commentsStatus === view.id ? "active" : undefined}
								onClick={() => switchStatus(view.id)}
							>
								{view.label}
							</button>
						))}
					</div>
					<form className="admin-comment-search" onSubmit={search}>
						<label>
							Search comments
							<input
								type="search"
								value={query}
								onChange={(event) => setQuery(event.currentTarget.value)}
							/>
						</label>
						<button type="submit">Search</button>
					</form>
				</div>
				<p className="admin-note">{listStatus}</p>
				{listError ? <p className="admin-error">{listError}</p> : null}
				{comments.length > 0 ? (
					<ol className="admin-comment-management-list">
						{comments.map((comment) => (
							<li className="admin-comment-item" key={comment.id}>
								<header>
									<div>
										<strong>{comment.nickname || "Anonymous"}</strong>
										<time dateTime={comment.createdAt}>
											{formatCommentDate(comment.createdAt)}
										</time>
										<a href={postHref(comment)}>{comment.post.title}</a>
									</div>
									<div className="admin-comment-actions">
										<span
											className={`admin-comment-status ${comment.moderationStatus}`}
										>
											{comment.moderationStatus === "approved"
												? "Approved"
												: "Pending"}
										</span>
										{comment.moderationStatus === "pending" ? (
											<button
												type="button"
												disabled={actionPending?.startsWith(`${comment.id}:`)}
												onClick={() =>
													updateComment(
														comment,
														{ moderationStatus: "approved" },
														"Comment approved.",
													)
												}
											>
												Approve
											</button>
										) : null}
										<button
											type="button"
											className="danger-link"
											disabled={actionPending === `${comment.id}:delete`}
											onClick={() => deleteComment(comment)}
										>
											{actionPending === `${comment.id}:delete`
												? "Deleting..."
												: "Delete"}
										</button>
									</div>
								</header>
								<p>{comment.body}</p>
								{comment.replyBody ? (
									<div className="admin-comment-existing-reply">
										<strong>Reply</strong>
										<p>{comment.replyBody}</p>
										{comment.replyCreatedAt ? (
											<time dateTime={comment.replyCreatedAt}>
												{formatCommentDate(comment.replyCreatedAt)}
											</time>
										) : null}
									</div>
								) : null}
								<label className="admin-comment-reply">
									Reply to {comment.nickname || "Anonymous"}
									<textarea
										value={replyDrafts[comment.id] ?? ""}
										rows={3}
										maxLength={2000}
										onChange={(event) => {
											const nextReply = event.currentTarget.value;
											setReplyDrafts((current) => ({
												...current,
												[comment.id]: nextReply,
											}));
										}}
									/>
								</label>
								<div className="admin-comment-reply-actions">
									<button
										type="button"
										disabled={actionPending?.startsWith(`${comment.id}:`)}
										onClick={() =>
											updateComment(
												comment,
												{ replyBody: replyDrafts[comment.id] ?? "" },
												"Reply saved.",
											)
										}
									>
										Save reply
									</button>
								</div>
							</li>
						))}
					</ol>
				) : (
					<p className="admin-note">No comments in this view.</p>
				)}
				<div className="admin-pagination">
					<button
						type="button"
						disabled={page <= 1}
						onClick={() => setPage((current) => Math.max(1, current - 1))}
					>
						Previous
					</button>
					<span>
						Page {page} of {pageCount}
					</span>
					<button
						type="button"
						disabled={page >= pageCount}
						onClick={() => setPage((current) => current + 1)}
					>
						Next
					</button>
				</div>
			</section>
			{toast ? (
				<div className="admin-toast" role="status">
					{toast}
				</div>
			) : null}
		</div>
	);
}
```

- [ ] **Step 4: Run component tests**

Run:

```bash
npm test -- tests/admin-ui.test.tsx
```

Expected: the new `CommentManagementPanel` tests pass. Existing admin UI tests may still pass because routing has not changed yet.

- [ ] **Step 5: Commit component**

Run:

```bash
git add app/components/admin/CommentManagementPanel.tsx tests/admin-ui.test.tsx
git commit -m "Add admin comment management panel"
```

## Task 3: Wire Admin Navigation and Settings Entry

**Files:**
- Modify: `app/components/admin/AdminShell.tsx`
- Modify: `app/routes/admin.tsx`
- Modify: `tests/admin-ui.test.tsx`

- [ ] **Step 1: Add failing route and entry tests**

In `tests/admin-ui.test.tsx`, add these tests inside `describe("Admin", () => {`:

```ts
	it("shows comment management from settings and sidebar navigation", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation(async (path: string) => {
			if (path === "/api/admin/me") {
				return {
					authenticated: true,
					csrfToken: "csrf-token",
					mustChangePassword: false,
				};
			}
			if (path === "/api/admin/settings") {
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
			}
			if (path === "/api/admin/posts/comment-settings") {
				return {
					defaultEnabled: true,
					globalEnabled: true,
					moderationEnabled: false,
				};
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return {
					items: [],
					total: 0,
					page: 1,
					limit: 20,
				};
			}
			throw new Error(`Unexpected GET ${path}`);
		});

		try {
			renderAdmin("/admin/settings");

			const commentsLink = await screen.findByRole("link", {
				name: "Comment management",
			});
			expect(commentsLink).toHaveAttribute("href", "/admin/comments");
			expect(screen.getByRole("link", { name: "Comments" })).toBeTruthy();

			fireEvent.click(commentsLink);
			await screen.findByRole("heading", { name: "Comment management" });
			expect(screen.getByRole("link", { name: "Comments" })).toHaveClass("active");
			expect(screen.getByTestId("admin-location")).toHaveTextContent(
				"/admin/comments",
			);
		} finally {
			apiGet.mockRestore();
		}
	});

	it("loads comment management from a direct admin section path", async () => {
		const apiGet = vi.spyOn(apiClient, "apiGet").mockImplementation(async (path: string) => {
			if (path === "/api/admin/me") {
				return {
					authenticated: true,
					csrfToken: "csrf-token",
					mustChangePassword: false,
				};
			}
			if (path === "/api/admin/posts/comment-settings") {
				return {
					defaultEnabled: true,
					globalEnabled: true,
					moderationEnabled: false,
				};
			}
			if (path === "/api/admin/comments?status=pending&page=1&limit=20") {
				return {
					items: [],
					total: 0,
					page: 1,
					limit: 20,
				};
			}
			throw new Error(`Unexpected GET ${path}`);
		});

		try {
			renderAdmin("/admin/comments");

			await screen.findByRole("heading", { name: "Comment management" });
			expect(screen.getByRole("link", { name: "Comments" })).toHaveClass("active");
			expect(screen.getByText("No comments in this view.")).toBeTruthy();
			expect(screen.getByTestId("admin-location")).toHaveTextContent(
				"/admin/comments",
			);
		} finally {
			apiGet.mockRestore();
		}
	});
```

- [ ] **Step 2: Run route tests and verify navigation is missing**

Run:

```bash
npm test -- tests/admin-ui.test.tsx
```

Expected: the new route tests fail because `/admin/comments` and the `Comments` sidebar link do not exist yet.

- [ ] **Step 3: Update `AdminShell` navigation**

In `app/components/admin/AdminShell.tsx`, change the section type:

```ts
export type AdminSection =
	| "overview"
	| "settings"
	| "comments"
	| "sync"
	| "posts"
	| "album";
```

Change `settingsSections` to:

```ts
const settingsSections: Array<{ id: AdminSection; label: string; path: string }> = [
	{ id: "settings", label: "Settings", path: "/admin/settings" },
	{ id: "comments", label: "Comments", path: "/admin/comments" },
];
```

- [ ] **Step 4: Wire `/admin/comments` and settings entry**

In `app/routes/admin.tsx`, add the import:

```ts
import { CommentManagementPanel } from "../components/admin/CommentManagementPanel";
```

Inside the `/admin/settings` element, after the `SettingsPanel` section, add:

```tsx
							<section
								className="admin-module admin-settings-entry-card"
								aria-labelledby="admin-comments-entry-heading"
							>
								<div className="admin-section-heading compact">
									<h2 id="admin-comments-entry-heading">Comment management</h2>
									<span className="admin-badge">Comments</span>
								</div>
								<p className="admin-note">
									Review pending comments, reply to visitors, delete comments,
									and adjust comment settings from one dedicated page.
								</p>
								<NavLink className="admin-secondary-button" to="/admin/comments">
									Comment management
								</NavLink>
							</section>
```

Update the imports at the top of `app/routes/admin.tsx` so React Router imports include `NavLink`:

```ts
import { Navigate, NavLink, Route, Routes } from "react-router";
```

Add the route before the wildcard route:

```tsx
				<Route
					path="comments"
					element={<CommentManagementPanel csrfToken={session.csrfToken} />}
				/>
```

- [ ] **Step 5: Run route tests**

Run:

```bash
npm test -- tests/admin-ui.test.tsx
```

Expected: all tests in `tests/admin-ui.test.tsx` pass.

- [ ] **Step 6: Commit navigation**

Run:

```bash
git add app/components/admin/AdminShell.tsx app/routes/admin.tsx tests/admin-ui.test.tsx
git commit -m "Wire admin comment management route"
```

## Task 4: Add Focused Admin Styles

**Files:**
- Modify: `app/app.css`
- Modify: `tests/admin-styles.test.ts`

- [ ] **Step 1: Add failing style tests**

In `tests/admin-styles.test.ts`, add:

```ts
	it("styles the comment management page with stable list and toolbar sizing", () => {
		const settingsEntryRule = cssRule(".admin-settings-entry-card");
		const toolbarRule = cssRule(".admin-comment-toolbar");
		const tabsRule = cssRule(".admin-comment-tabs");
		const listRule = cssRule(".admin-comment-management-list");

		expect(settingsEntryRule).toContain("align-self: stretch");
		expect(toolbarRule).toContain("display: grid");
		expect(toolbarRule).toContain("gap: 1rem");
		expect(tabsRule).toContain("display: flex");
		expect(listRule).toContain("display: grid");
		expect(listRule).toContain("gap: 1rem");
	});
```

- [ ] **Step 2: Run style tests and verify selectors are missing**

Run:

```bash
npm test -- tests/admin-styles.test.ts
```

Expected: the new test fails because the CSS selectors have not been added.

- [ ] **Step 3: Add CSS selectors**

Add these rules to `app/app.css` near the existing admin comment styles:

```css
.admin-settings-entry-card {
	align-self: stretch;
}

.admin-comment-management {
	position: relative;
}

.admin-comment-settings {
	display: grid;
	gap: 0.85rem;
}

.admin-comment-list-module {
	display: grid;
	gap: 1rem;
}

.admin-comment-toolbar {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	gap: 1rem;
	align-items: end;
}

.admin-comment-tabs {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
}

.admin-comment-tabs button.active {
	background: #111827;
	color: #ffffff;
	border-color: #111827;
}

.admin-comment-search {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 0.75rem;
	align-items: end;
}

.admin-comment-management-list {
	display: grid;
	gap: 1rem;
	margin: 0;
	padding: 0;
	list-style: none;
}

.admin-comment-existing-reply {
	display: grid;
	gap: 0.25rem;
	padding: 0.75rem;
	border: 1px solid #e5e7eb;
	border-radius: 8px;
	background: #f9fafb;
}

.admin-comment-existing-reply p {
	margin: 0;
}

@media (min-width: 760px) {
	.admin-comment-toolbar {
		grid-template-columns: auto minmax(18rem, 1fr);
	}
}

@media (max-width: 640px) {
	.admin-comment-search {
		grid-template-columns: minmax(0, 1fr);
	}
}
```

- [ ] **Step 4: Run style tests**

Run:

```bash
npm test -- tests/admin-styles.test.ts
```

Expected: all tests in `tests/admin-styles.test.ts` pass.

- [ ] **Step 5: Run admin UI tests after styles**

Run:

```bash
npm test -- tests/admin-ui.test.tsx
```

Expected: all tests in `tests/admin-ui.test.tsx` pass.

- [ ] **Step 6: Commit styles**

Run:

```bash
git add app/app.css tests/admin-styles.test.ts
git commit -m "Style admin comment management"
```

## Task 5: Final Verification

**Files:**
- Test only.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
npm test -- tests/sync.test.ts
```

Expected: pass.

- [ ] **Step 2: Run focused admin UI tests**

Run:

```bash
npm test -- tests/admin-ui.test.tsx tests/admin-styles.test.ts
```

Expected: pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: pass.

- [ ] **Step 4: Run production build**

Run:

```bash
npm run build
```

Expected: pass.

- [ ] **Step 5: Check final git state**

Run:

```bash
git status --short
```

Expected after successful implementation: no unstaged or uncommitted changes remain. If this command prints changed files, return to the task that owns those files, finish its test-and-commit cycle, then run final verification again.

## Spec Coverage Review

- Settings page entry: Task 3.
- Sidebar entry: Task 3.
- `/admin/comments` route: Task 3.
- Global comment settings on new page: Task 2.
- Pending, approved, and all views: Task 2.
- Default pending view: Task 2.
- Search by body, nickname, and post title: Task 1 and Task 2.
- Pagination and newest-first ordering: Task 1 and Task 2.
- Approve, reply, and delete single-comment actions: Task 2.
- Existing Posts comment modal preserved: Task 2 and Task 5 keep existing tests passing.
