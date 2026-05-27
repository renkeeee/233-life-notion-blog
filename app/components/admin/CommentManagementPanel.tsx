import { useEffect, useMemo, useRef, useState } from "react";
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
	const [commentsStatus, setCommentsStatus] =
		useState<CommentStatusFilter>("pending");
	const [query, setQuery] = useState("");
	const [appliedQuery, setAppliedQuery] = useState("");
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [listStatus, setListStatus] = useState("Loading comments...");
	const [listError, setListError] = useState<string | null>(null);
	const [listPending, setListPending] = useState(false);
	const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
	const [actionPending, setActionPending] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const commentsStatusRef = useRef(commentsStatus);
	const commentsRef = useRef(comments);

	const pageCount = useMemo(
		() => Math.max(1, Math.ceil(total / pageSize)),
		[total],
	);

	useEffect(() => {
		commentsStatusRef.current = commentsStatus;
	}, [commentsStatus]);

	useEffect(() => {
		commentsRef.current = comments;
	}, [comments]);

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
					setSettingsStatus(
						errorMessage(error, "Comment settings could not be loaded."),
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		setListPending(true);
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
				setListPending(false);
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setComments([]);
					setTotal(0);
					setListStatus("Comments could not be loaded.");
					setListError(errorMessage(error, "Comments could not be loaded."));
					setListPending(false);
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
			setSettingsStatus(
				errorMessage(error, "Comment settings could not be saved."),
			);
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

	function clampPageForTotal(nextTotal: number) {
		const nextPageCount = Math.max(1, Math.ceil(nextTotal / pageSize));
		setPage((currentPage) => Math.min(currentPage, nextPageCount));
	}

	function decrementVisibleTotal() {
		setTotal((currentTotal) => {
			const nextTotal = Math.max(0, currentTotal - 1);
			clampPageForTotal(nextTotal);
			return nextTotal;
		});
	}

	function replaceComment(comment: AdminComment) {
		const currentStatus = commentsStatusRef.current;
		const isInCurrentList = commentsRef.current.some(
			(item) => item.id === comment.id,
		);
		const remainsVisible = visibleCommentAfterUpdate(currentStatus, comment);

		setComments((current) => {
			if (!current.some((item) => item.id === comment.id)) {
				return current;
			}

			if (!remainsVisible) {
				return current.filter((item) => item.id !== comment.id);
			}

			return current.map((item) => (item.id === comment.id ? comment : item));
		});
		setReplyDrafts((current) => ({
			...current,
			[comment.id]: comment.replyBody ?? current[comment.id] ?? "",
		}));
		if (isInCurrentList && !remainsVisible) {
			decrementVisibleTotal();
		}
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
				`/api/admin/posts/${encodeURIComponent(
					comment.post.id,
				)}/comments/${encodeURIComponent(comment.id)}`,
				body,
				csrfToken,
			);
			replaceComment(commentFromUpdate(comment, response.comment));
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
				`/api/admin/posts/${encodeURIComponent(
					comment.post.id,
				)}/comments/${encodeURIComponent(comment.id)}`,
				csrfToken,
			);
			setComments((current) => current.filter((item) => item.id !== comment.id));
			decrementVisibleTotal();
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
					<div
						className="admin-comment-tabs"
						role="group"
						aria-label="Comment status"
					>
						{commentViews.map((view) => (
							<button
								type="button"
								key={view.id}
								className={commentsStatus === view.id ? "active" : undefined}
								aria-pressed={commentsStatus === view.id}
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
												disabled={
													listPending ||
													actionPending?.startsWith(`${comment.id}:`)
												}
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
											disabled={
												listPending || actionPending === `${comment.id}:delete`
											}
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
										disabled={
											listPending ||
											actionPending?.startsWith(`${comment.id}:`)
										}
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
						disabled={listPending || page <= 1}
						onClick={() => setPage((current) => Math.max(1, current - 1))}
					>
						Previous
					</button>
					<span>
						Page {page} of {pageCount}
					</span>
					<button
						type="button"
						disabled={listPending || page >= pageCount}
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
