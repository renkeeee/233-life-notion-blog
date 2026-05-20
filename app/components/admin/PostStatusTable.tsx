import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { apiGet, apiPost, apiPut } from "../../lib/api-client";

type AdminPostRecord = {
	id: string;
	title?: string | null;
	slug?: string | null;
	status?: string | null;
	visibility?: string | null;
	manualVisibility?: "visible" | "hidden" | null;
	locked?: boolean | null;
	commentsEnabled?: boolean | null;
	lockPassword?: string | null;
	publishedAt?: string | null;
	notionLastEditedTime?: string | null;
	updatedAt?: string | null;
	lastSyncError?: string | null;
};

type PostsResponse =
	| {
			items: AdminPostRecord[];
			total?: number;
			page?: number;
			limit?: number;
	  }
	| AdminPostRecord[];

type SortOption = {
	value: string;
	label: string;
	sortBy: string;
	sortDirection: "asc" | "desc";
};

type AdminPostAction =
	| "hide"
	| "restore"
	| "lock"
	| "unlock"
	| "comments-on"
	| "comments-off"
	| "delete";

type CommentSettingsResponse = {
	defaultEnabled: boolean;
};

const pageSize = 20;
const sortOptions: SortOption[] = [
	{
		value: "updatedAt:desc",
		label: "Recently updated",
		sortBy: "updatedAt",
		sortDirection: "desc",
	},
	{
		value: "updatedAt:asc",
		label: "Oldest updated",
		sortBy: "updatedAt",
		sortDirection: "asc",
	},
	{
		value: "publishedAt:desc",
		label: "Newest published",
		sortBy: "publishedAt",
		sortDirection: "desc",
	},
	{
		value: "publishedAt:asc",
		label: "Oldest published",
		sortBy: "publishedAt",
		sortDirection: "asc",
	},
	{
		value: "notionLastEditedTime:desc",
		label: "Recently edited in Notion",
		sortBy: "notionLastEditedTime",
		sortDirection: "desc",
	},
	{
		value: "notionLastEditedTime:asc",
		label: "Oldest edited in Notion",
		sortBy: "notionLastEditedTime",
		sortDirection: "asc",
	},
	{
		value: "title:asc",
		label: "Title A-Z",
		sortBy: "title",
		sortDirection: "asc",
	},
];

const actionLabels: Record<AdminPostAction, string> = {
	hide: "hidden",
	restore: "restored",
	lock: "locked",
	unlock: "unlocked",
	"comments-on": "comments enabled",
	"comments-off": "comments disabled",
	delete: "deleted",
};

function responseItems(response: PostsResponse): AdminPostRecord[] {
	return Array.isArray(response) ? response : response.items;
}

function responseTotal(response: PostsResponse, items: AdminPostRecord[]): number {
	return Array.isArray(response) ? items.length : (response.total ?? items.length);
}

function postTitle(post: AdminPostRecord): string {
	return post.title?.trim() || "Untitled";
}

function postHref(post: AdminPostRecord): string {
	const slug = post.slug?.trim();
	return slug ? `/post/${encodeURIComponent(slug)}` : "#";
}

function formatDate(value?: string | null): string {
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

function sortOptionFor(value: string): SortOption {
	return sortOptions.find((option) => option.value === value) ?? sortOptions[0];
}

function buildPostsPath({
	page,
	q,
	status,
	sort,
}: {
	page: number;
	q: string;
	status: string;
	sort: string;
}): string {
	const sortOption = sortOptionFor(sort);
	const params = new URLSearchParams();
	params.set("page", String(page));
	params.set("limit", String(pageSize));
	if (q.trim()) {
		params.set("q", q.trim());
	}
	if (status.trim()) {
		params.set("status", status.trim());
	}
	params.set("sortBy", sortOption.sortBy);
	params.set("sortDirection", sortOption.sortDirection);

	return `/api/admin/posts?${params.toString()}`;
}

function rangeLabel(page: number, limit: number, total: number): string {
	if (total === 0) {
		return "No posts";
	}

	const start = (page - 1) * limit + 1;
	const end = Math.min(page * limit, total);
	return `${start}-${end} of ${total} posts`;
}

function EyeIcon() {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="15"
			viewBox="0 0 24 24"
			width="15"
		>
			<path
				d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="2"
			/>
			<path
				d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="2"
			/>
		</svg>
	);
}

export function PostStatusTable({ csrfToken }: { csrfToken: string }) {
	const [posts, setPosts] = useState<AdminPostRecord[]>([]);
	const [status, setStatus] = useState("Loading post status...");
	const [error, setError] = useState<string | null>(null);
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [titleKeyword, setTitleKeyword] = useState("");
	const [appliedTitleKeyword, setAppliedTitleKeyword] = useState("");
	const [statusFilter, setStatusFilter] = useState("");
	const [appliedStatusFilter, setAppliedStatusFilter] = useState("");
	const [sort, setSort] = useState(sortOptions[0].value);
	const [appliedSort, setAppliedSort] = useState(sortOptions[0].value);
	const [actionPending, setActionPending] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const [lockDialogPost, setLockDialogPost] =
		useState<AdminPostRecord | null>(null);
	const [deleteDialogPost, setDeleteDialogPost] =
		useState<AdminPostRecord | null>(null);
	const [passwordDialogPost, setPasswordDialogPost] =
		useState<AdminPostRecord | null>(null);
	const [lockPassword, setLockPassword] = useState("");
	const [defaultCommentsEnabled, setDefaultCommentsEnabled] = useState(true);
	const [commentSettingsStatus, setCommentSettingsStatus] =
		useState("Loading comment defaults...");
	const [commentSettingsPending, setCommentSettingsPending] = useState(false);

	const pageCount = useMemo(
		() => Math.max(1, Math.ceil(total / pageSize)),
		[total],
	);

	useEffect(() => {
		let cancelled = false;
		setCommentSettingsStatus("Loading comment defaults...");

		apiGet<CommentSettingsResponse>("/api/admin/posts/comment-settings")
			.then((response) => {
				if (cancelled) {
					return;
				}

				setDefaultCommentsEnabled(response.defaultEnabled);
				setCommentSettingsStatus("Default loaded.");
			})
			.catch((loadError: unknown) => {
				if (!cancelled) {
					setCommentSettingsStatus(
						loadError instanceof Error
							? loadError.message
							: "Comment defaults could not be loaded.",
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		const path = buildPostsPath({
			page,
			q: appliedTitleKeyword,
			status: appliedStatusFilter,
			sort: appliedSort,
		});

		setStatus("Loading post status...");
		setError(null);

		apiGet<PostsResponse>(path)
			.then((response) => {
				if (cancelled) {
					return;
				}

				const items = responseItems(response);
				const nextTotal = responseTotal(response, items);
				const nextPage = Array.isArray(response) ? page : (response.page ?? page);
				const nextLimit = Array.isArray(response)
					? pageSize
					: (response.limit ?? pageSize);
				setPosts(items);
				setTotal(nextTotal);
				setStatus(rangeLabel(nextPage, nextLimit, nextTotal));
			})
			.catch((loadError: unknown) => {
				if (!cancelled) {
					setPosts([]);
					setTotal(0);
					setError(
						loadError instanceof Error
							? loadError.message
							: "Post status endpoint is not available.",
					);
					setStatus("Posts could not be loaded.");
				}
			});

		return () => {
			cancelled = true;
		};
	}, [page, appliedTitleKeyword, appliedStatusFilter, appliedSort]);

	useEffect(() => {
		if (!toast) {
			return;
		}

		const timeoutId = window.setTimeout(() => setToast(null), 3000);
		return () => window.clearTimeout(timeoutId);
	}, [toast]);

	function applyFilters(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setAppliedTitleKeyword(titleKeyword);
		setAppliedStatusFilter(statusFilter);
		setAppliedSort(sort);
		setPage(1);
	}

	async function saveCommentDefaults() {
		setCommentSettingsPending(true);
		setCommentSettingsStatus("Saving comment defaults...");
		try {
			const response = await apiPut<CommentSettingsResponse>(
				"/api/admin/posts/comment-settings",
				{ enabled: defaultCommentsEnabled },
				csrfToken,
			);
			setDefaultCommentsEnabled(response.defaultEnabled);
			setCommentSettingsStatus("Comment default saved.");
			setToast("Comment default saved.");
		} catch (error) {
			setCommentSettingsStatus(
				error instanceof Error
					? error.message
					: "Comment default could not be saved.",
			);
		} finally {
			setCommentSettingsPending(false);
		}
	}

	async function runAction(
		post: AdminPostRecord,
		action: AdminPostAction,
		options: { password?: string } = {},
	) {
		const title = postTitle(post);
		const password = options.password ?? "";
		if (action === "lock" && !password.trim()) {
			setError("Password is required.");
			setLockDialogPost(post);
			return;
		}

		setActionPending(`${post.id}:${action}`);
		setError(null);

		try {
			await apiPost(
				`/api/admin/posts/${encodeURIComponent(post.id)}/${action}`,
				action === "lock" ? { password } : {},
				csrfToken,
			);
			if (
				action === "hide" ||
				action === "restore" ||
				action === "comments-on" ||
				action === "comments-off"
			) {
				setToast(`${title} ${actionLabels[action]}.`);
			}
			if (action === "lock") {
				setLockPassword("");
				setLockDialogPost(null);
				setPasswordDialogPost(null);
			}
			if (action === "unlock") {
				setPasswordDialogPost(null);
			}
			if (action === "delete") {
				setDeleteDialogPost(null);
				setPasswordDialogPost(null);
			}
			const response = await apiGet<PostsResponse>(
				buildPostsPath({
					page,
					q: appliedTitleKeyword,
					status: appliedStatusFilter,
					sort: appliedSort,
				}),
			);
			const items = responseItems(response);
			const nextTotal = responseTotal(response, items);
			setPosts(items);
			setTotal(nextTotal);
			setStatus(
				rangeLabel(
					Array.isArray(response) ? page : (response.page ?? page),
					Array.isArray(response) ? pageSize : (response.limit ?? pageSize),
					nextTotal,
				),
			);
		} catch (actionError) {
			setError(
				actionError instanceof Error ? actionError.message : "Post action failed.",
			);
		} finally {
			setActionPending(null);
		}
	}

	return (
		<div className="admin-stack">
			<div className="admin-section-heading">
				<h2>Post status</h2>
				<span className="admin-badge">Database view</span>
			</div>

			<section className="admin-module admin-post-comment-settings">
				<div>
					<h3>Comment defaults</h3>
					<p className="admin-note">
						Controls whether newly synced posts accept comments by default.
					</p>
				</div>
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
				<div className="admin-inline-actions">
					<button
						type="button"
						disabled={commentSettingsPending}
						onClick={saveCommentDefaults}
					>
						{commentSettingsPending ? "Saving..." : "Save default"}
					</button>
					<span>{commentSettingsStatus}</span>
				</div>
			</section>

			<form className="admin-form admin-post-filters" onSubmit={applyFilters}>
				<label>
					Title keyword
					<input
						type="search"
						value={titleKeyword}
						onChange={(event) => setTitleKeyword(event.currentTarget.value)}
					/>
				</label>
				<label>
					Status
					<input
						type="search"
						value={statusFilter}
						onChange={(event) => setStatusFilter(event.currentTarget.value)}
					/>
				</label>
				<label>
					Sort
					<select
						value={sort}
						onChange={(event) => setSort(event.currentTarget.value)}
					>
						{sortOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				<button type="submit">Apply filters</button>
			</form>

			<p className="admin-note">{status}</p>
			{error ? <p className="admin-error">{error}</p> : null}

			{posts.length > 0 ? (
				<div className="admin-table-wrap">
					<table className="admin-table admin-post-table">
						<thead>
							<tr>
								<th>Title</th>
								<th>Visibility</th>
								<th>Updated</th>
								<th>Sync error</th>
								<th>Actions</th>
							</tr>
						</thead>
						<tbody>
							{posts.map((post) => {
								const title = postTitle(post);
								const isHidden = post.manualVisibility === "hidden";
								const isLocked = post.locked === true;
								const commentsEnabled = post.commentsEnabled !== false;
								const pendingAction = (action: string) =>
									actionPending === `${post.id}:${action}`;

								return (
									<tr key={post.id}>
										<td>
											<a className="admin-post-title-link" href={postHref(post)}>
												{title}
											</a>
										</td>
										<td>
											{post.visibility ?? "-"}
											{isHidden ? " / manually hidden" : ""}
											{isLocked ? " / locked" : ""}
											{commentsEnabled ? "" : " / comments off"}
										</td>
										<td>
											{formatDate(post.notionLastEditedTime ?? post.updatedAt)}
										</td>
										<td>{post.lastSyncError ?? "-"}</td>
										<td className="admin-actions-cell">
											<div className="admin-row-actions">
												<button
													type="button"
													disabled={pendingAction(isHidden ? "restore" : "hide")}
													onClick={() =>
														runAction(post, isHidden ? "restore" : "hide")
													}
												>
													{isHidden ? "Restore" : "Hide"}
												</button>
												{isLocked ? (
													<button
														type="button"
														disabled={pendingAction("unlock")}
														onClick={() => runAction(post, "unlock")}
													>
														Unlock
													</button>
												) : (
													<button
														type="button"
														disabled={pendingAction("lock")}
														onClick={() => {
															setLockPassword("");
															setLockDialogPost(post);
														}}
													>
														Lock
													</button>
												)}
												<button
													type="button"
													disabled={pendingAction(
														commentsEnabled ? "comments-off" : "comments-on",
													)}
													onClick={() =>
														runAction(
															post,
															commentsEnabled ? "comments-off" : "comments-on",
														)
													}
												>
													{commentsEnabled
														? "Disable comments"
														: "Enable comments"}
												</button>
												<button
													type="button"
													className="danger-link"
													disabled={pendingAction("delete")}
													onClick={() => setDeleteDialogPost(post)}
												>
													Delete
												</button>
												{isLocked && post.lockPassword ? (
													<span className="admin-password-action">
														<button
															type="button"
															aria-label="Show password"
															className="admin-action-icon"
															onClick={() => setPasswordDialogPost(post)}
														>
															<EyeIcon />
														</button>
													</span>
												) : null}
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			) : null}

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
			{toast ? (
				<div className="admin-toast" role="status">
					{toast}
				</div>
			) : null}
			{lockDialogPost ? (
				<div className="admin-modal-backdrop">
					<form
						className="admin-modal"
						role="dialog"
						aria-label="Lock post"
						aria-modal="true"
						onSubmit={(event) => {
							event.preventDefault();
							runAction(lockDialogPost, "lock", { password: lockPassword });
						}}
					>
						<h3>Lock {postTitle(lockDialogPost)}</h3>
						<label>
							Post password
							<input
								autoFocus
								type="text"
								value={lockPassword}
								onChange={(event) =>
									setLockPassword(event.currentTarget.value)
								}
							/>
						</label>
						<div className="admin-modal-actions">
							<button
								type="button"
								className="admin-modal-secondary"
								onClick={() => {
									setLockPassword("");
									setLockDialogPost(null);
								}}
							>
								Cancel
							</button>
							<button
								type="submit"
								disabled={actionPending === `${lockDialogPost.id}:lock`}
							>
								Lock
							</button>
						</div>
					</form>
				</div>
			) : null}
			{passwordDialogPost ? (
				<div className="admin-modal-backdrop">
					<div
						className="admin-modal"
						role="dialog"
						aria-label="Post password"
						aria-modal="true"
					>
						<h3>Post password</h3>
						<p>{postTitle(passwordDialogPost)}</p>
						<p className="admin-password-value">
							{passwordDialogPost.lockPassword}
						</p>
						<div className="admin-modal-actions">
							<button
								type="button"
								className="admin-modal-secondary"
								onClick={() => setPasswordDialogPost(null)}
							>
								Close
							</button>
						</div>
					</div>
				</div>
			) : null}
			{deleteDialogPost ? (
				<div className="admin-modal-backdrop">
					<div
						className="admin-modal"
						role="dialog"
						aria-label="Delete post"
						aria-modal="true"
					>
						<h3>Delete post</h3>
						<p>This will permanently delete {postTitle(deleteDialogPost)}.</p>
						<p>
							It will not sync again unless a force sync imports it from Notion.
						</p>
						<div className="admin-modal-actions">
							<button
								type="button"
								className="admin-modal-secondary"
								onClick={() => setDeleteDialogPost(null)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="danger"
								disabled={actionPending === `${deleteDialogPost.id}:delete`}
								onClick={() => runAction(deleteDialogPost, "delete")}
							>
								Delete
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
