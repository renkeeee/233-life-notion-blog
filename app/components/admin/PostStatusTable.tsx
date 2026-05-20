import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { apiGet, apiPost } from "../../lib/api-client";

type AdminPostRecord = {
	id: string;
	title?: string | null;
	slug?: string | null;
	status?: string | null;
	visibility?: string | null;
	manualVisibility?: "visible" | "hidden" | null;
	locked?: boolean | null;
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

const actionLabels: Record<
	"hide" | "restore" | "lock" | "unlock" | "delete",
	string
> = {
	hide: "hidden",
	restore: "restored",
	lock: "locked",
	unlock: "unlocked",
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
	const [passwords, setPasswords] = useState<Record<string, string>>({});
	const [actionPending, setActionPending] = useState<string | null>(null);
	const [lockPopoverPostId, setLockPopoverPostId] = useState<string | null>(null);

	const pageCount = useMemo(
		() => Math.max(1, Math.ceil(total / pageSize)),
		[total],
	);

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

	function applyFilters(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setAppliedTitleKeyword(titleKeyword);
		setAppliedStatusFilter(statusFilter);
		setAppliedSort(sort);
		setPage(1);
	}

	async function runAction(
		post: AdminPostRecord,
		action: "hide" | "restore" | "lock" | "unlock" | "delete",
	) {
		const title = postTitle(post);
		if (action === "delete") {
			const confirmed = window.confirm(
				`Permanently delete "${title}"? It will only sync again during a forced sync.`,
			);
			if (!confirmed) {
				return;
			}
		}

		const password = passwords[post.id] ?? "";
		if (action === "lock" && !password.trim()) {
			setError("Password is required.");
			setLockPopoverPostId(post.id);
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
			setStatus(`${title} ${actionLabels[action]}.`);
			if (action === "lock") {
				setPasswords((current) => ({ ...current, [post.id]: "" }));
				setLockPopoverPostId(null);
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
								<th>Status</th>
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
								const pendingAction = (action: string) =>
									actionPending === `${post.id}:${action}`;

								return (
									<tr key={post.id}>
										<td>
											<a className="admin-post-title-link" href={postHref(post)}>
												{title}
											</a>
											<span className="admin-post-slug">
												{post.slug ?? "-"}
											</span>
										</td>
										<td>{post.status ?? "-"}</td>
										<td>
											{post.visibility ?? "-"}
											{isHidden ? " / manually hidden" : ""}
											{isLocked ? " / locked" : ""}
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
													<>
														{post.lockPassword ? (
															<span className="admin-secret">
																Password: {post.lockPassword}
															</span>
														) : null}
														<button
															type="button"
															disabled={pendingAction("unlock")}
															onClick={() => runAction(post, "unlock")}
														>
															Unlock
														</button>
													</>
												) : (
													<div className="admin-lock-action">
														<button
															type="button"
															disabled={pendingAction("lock")}
															onClick={() =>
																setLockPopoverPostId((current) =>
																	current === post.id ? null : post.id,
																)
															}
														>
															Lock
														</button>
														{lockPopoverPostId === post.id ? (
															<div
																className="admin-lock-popover"
																role="dialog"
																aria-label="Lock post"
															>
																<label>
																	Post password
																	<input
																		autoFocus
																		type="text"
																		value={passwords[post.id] ?? ""}
																		onChange={(event) => {
																			const value = event.currentTarget.value;
																			setPasswords((current) => ({
																				...current,
																				[post.id]: value,
																			}));
																		}}
																	/>
																</label>
																<div className="admin-lock-popover-actions">
																	<button
																		type="button"
																		disabled={pendingAction("lock")}
																		onClick={() => runAction(post, "lock")}
																	>
																		Save
																	</button>
																	<button
																		type="button"
																		onClick={() => setLockPopoverPostId(null)}
																	>
																		Cancel
																	</button>
																</div>
															</div>
														) : null}
													</div>
												)}
												<button
													type="button"
													disabled={pendingAction("delete")}
													onClick={() => runAction(post, "delete")}
												>
													Delete
												</button>
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
		</div>
	);
}
