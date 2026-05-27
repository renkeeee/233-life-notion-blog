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
	currentQuery: string,
): boolean {
	const statusMatches =
		currentStatus === "all" || comment.moderationStatus === currentStatus;
	if (!statusMatches) {
		return false;
	}

	const query = currentQuery.trim().toLowerCase();
	if (!query) {
		return true;
	}

	return [comment.nickname, comment.body, comment.post.title].some((value) =>
		value.toLowerCase().includes(query),
	);
}

export function CommentManagementPanel({ csrfToken }: { csrfToken: string }) {
	const [globalCommentsEnabled, setGlobalCommentsEnabled] = useState(true);
	const [defaultCommentsEnabled, setDefaultCommentsEnabled] = useState(true);
	const [moderationCommentsEnabled, setModerationCommentsEnabled] =
		useState(false);
	const [settingsStatus, setSettingsStatus] = useState("Loading comment settings...");
	const [settingsLoaded, setSettingsLoaded] = useState(false);
	const [settingsPending, setSettingsPending] = useState(false);
	const [comments, setComments] = useState<AdminComment[]>([]);
	const [commentsStatus, setCommentsStatus] =
		useState<CommentStatusFilter>("pending");
	const [query, setQuery] = useState("");
	const [appliedQuery, setAppliedQuery] = useState("");
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [listError, setListError] = useState<string | null>(null);
	const [listPending, setListPending] = useState(false);
	const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
	const [pendingActions, setPendingActions] = useState<Record<string, boolean>>({});
	const [refreshNonce, setRefreshNonce] = useState(0);
	const [toast, setToast] = useState<string | null>(null);
	const commentsStatusRef = useRef(commentsStatus);
	const appliedQueryRef = useRef(appliedQuery);
	const pageRef = useRef(page);
	const commentsRef = useRef(comments);
	const totalRef = useRef(total);
	const dirtyReplyDraftsRef = useRef<Record<string, boolean>>({});
	const listRequestIdRef = useRef(0);
	const listInvalidationRef = useRef(0);
	const backgroundRefreshRef = useRef(false);
	const settingsControlsDisabled = !settingsLoaded || settingsPending;

	const pageCount = useMemo(
		() => Math.max(1, Math.ceil(total / pageSize)),
		[total],
	);
	const listSummary = useMemo(() => {
		if (listPending) {
			return "Loading comments...";
		}
		if (listError) {
			return "Comments could not be loaded.";
		}
		if (total === 0) {
			return "No comments";
		}

		const effectivePage = Math.min(page, pageCount);
		const renderedCount = comments.length;
		const start = renderedCount > 0 ? (effectivePage - 1) * pageSize + 1 : 0;
		const end = renderedCount > 0 ? start + renderedCount - 1 : 0;
		return `${start}-${end} of ${total} comments`;
	}, [comments.length, listError, listPending, page, pageCount, total]);

	useEffect(() => {
		commentsStatusRef.current = commentsStatus;
	}, [commentsStatus]);

	useEffect(() => {
		appliedQueryRef.current = appliedQuery;
	}, [appliedQuery]);

	useEffect(() => {
		pageRef.current = page;
	}, [page]);

	useEffect(() => {
		commentsRef.current = comments;
	}, [comments]);

	useEffect(() => {
		totalRef.current = total;
	}, [total]);

	useEffect(() => {
		let cancelled = false;
		setSettingsLoaded(false);
		setSettingsStatus("Loading comment settings...");

		apiGet<CommentSettingsResponse>("/api/admin/posts/comment-settings")
			.then((response) => {
				if (cancelled) {
					return;
				}

				setGlobalCommentsEnabled(response.globalEnabled);
				setDefaultCommentsEnabled(response.defaultEnabled);
				setModerationCommentsEnabled(response.moderationEnabled === true);
				setSettingsLoaded(true);
				setSettingsStatus("Comment settings loaded.");
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setSettingsLoaded(false);
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
		const requestId = listRequestIdRef.current + 1;
		listRequestIdRef.current = requestId;
		const requestInvalidation = listInvalidationRef.current;
		const requestPage = page;
		const requestQuery = appliedQuery;
		const requestStatus = commentsStatus;
		const isBackgroundRefresh = backgroundRefreshRef.current;
		backgroundRefreshRef.current = false;
		if (!isBackgroundRefresh) {
			setListPending(true);
		}
		setListError(null);

		apiGet<AdminCommentsResponse>(
			commentsPath({ page, query: appliedQuery, status: commentsStatus }),
		)
			.then((response) => {
				if (cancelled) {
					return;
				}

				if (
					requestId !== listRequestIdRef.current ||
					requestInvalidation !== listInvalidationRef.current ||
					requestStatus !== commentsStatusRef.current ||
					requestQuery !== appliedQueryRef.current ||
					requestPage !== pageRef.current
				) {
					return;
				}

				const nextPageCount = Math.max(1, Math.ceil(response.total / pageSize));
				const nextPage = Math.min(requestPage, nextPageCount);
				if (nextPage !== requestPage) {
					totalRef.current = response.total;
					setTotal(response.total);
					pageRef.current = nextPage;
					setPage(nextPage);
					setListPending(false);
					return;
				}

				commentsRef.current = response.items;
				setComments(response.items);
				totalRef.current = response.total;
				setTotal(response.total);
				setReplyDrafts(
					(currentDrafts) =>
						Object.fromEntries(
							response.items.map((comment) => [
								comment.id,
								dirtyReplyDraftsRef.current[comment.id]
									? currentDrafts[comment.id] ?? ""
									: comment.replyBody ?? "",
							]),
						),
				);
				setListPending(false);
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					if (
						requestId !== listRequestIdRef.current ||
						requestInvalidation !== listInvalidationRef.current ||
						requestStatus !== commentsStatusRef.current ||
						requestQuery !== appliedQueryRef.current ||
						requestPage !== pageRef.current
					) {
						return;
					}

					commentsRef.current = [];
					setComments([]);
					totalRef.current = 0;
					setTotal(0);
					setListError(errorMessage(error, "Comments could not be loaded."));
					setListPending(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [appliedQuery, commentsStatus, page, refreshNonce]);

	useEffect(() => {
		if (!toast) {
			return;
		}

		const timeoutId = window.setTimeout(() => setToast(null), 3000);
		return () => window.clearTimeout(timeoutId);
	}, [toast]);

	async function saveCommentSettings() {
		if (!settingsLoaded || settingsPending) {
			return;
		}

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
			setSettingsLoaded(true);
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
		commentsStatusRef.current = nextStatus;
		pageRef.current = 1;
		setCommentsStatus(nextStatus);
		setPage(1);
	}

	function search(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const nextQuery = query;
		appliedQueryRef.current = nextQuery;
		pageRef.current = 1;
		setAppliedQuery(nextQuery);
		setPage(1);
	}

	function setVisibleTotal(nextTotal: number) {
		const nextPageCount = Math.max(1, Math.ceil(nextTotal / pageSize));
		totalRef.current = nextTotal;
		setTotal(nextTotal);
		setPage((currentPage) => {
			const nextPage = Math.min(currentPage, nextPageCount);
			pageRef.current = nextPage;
			return nextPage;
		});
	}

	function decrementVisibleTotal() {
		setVisibleTotal(Math.max(0, totalRef.current - 1));
	}

	function incrementVisibleTotal() {
		setVisibleTotal(totalRef.current + 1);
	}

	function setCommentList(nextComments: AdminComment[]) {
		commentsRef.current = nextComments;
		setComments(nextComments);
	}

	function actionKey(comment: AdminComment, action: string) {
		return `${comment.id}:${action}`;
	}

	function beginAction(key: string) {
		setPendingActions((current) => ({
			...current,
			[key]: true,
		}));
	}

	function endAction(key: string) {
		setPendingActions((current) => {
			const { [key]: _removed, ...next } = current;
			return next;
		});
	}

	function isActionPending(key: string): boolean {
		return pendingActions[key] === true;
	}

	function isRowPending(commentId: string): boolean {
		return Object.keys(pendingActions).some((key) =>
			key.startsWith(`${commentId}:`),
		);
	}

	function refreshCommentList() {
		listInvalidationRef.current += 1;
		backgroundRefreshRef.current = true;
		setRefreshNonce((current) => current + 1);
	}

	function markReplyDraftDirty(commentId: string) {
		dirtyReplyDraftsRef.current = {
			...dirtyReplyDraftsRef.current,
			[commentId]: true,
		};
	}

	function clearReplyDraftDirty(commentId: string) {
		const { [commentId]: _removed, ...nextDirtyDrafts } =
			dirtyReplyDraftsRef.current;
		dirtyReplyDraftsRef.current = nextDirtyDrafts;
	}

	function replaceComment(previousComment: AdminComment, comment: AdminComment) {
		const currentStatus = commentsStatusRef.current;
		const currentQuery = appliedQueryRef.current;
		const wasVisible = visibleCommentAfterUpdate(
			currentStatus,
			previousComment,
			currentQuery,
		);
		const remainsVisible = visibleCommentAfterUpdate(
			currentStatus,
			comment,
			currentQuery,
		);
		const currentComments = commentsRef.current;
		const isInCurrentList = currentComments.some((item) => item.id === comment.id);

		if (
			!isInCurrentList &&
			!wasVisible &&
			remainsVisible &&
			currentComments.length < pageSize &&
			totalRef.current <= currentComments.length
		) {
			setCommentList([comment, ...currentComments]);
			incrementVisibleTotal();
		} else if (isInCurrentList && !remainsVisible) {
			setCommentList(currentComments.filter((item) => item.id !== comment.id));
			decrementVisibleTotal();
		} else if (isInCurrentList) {
			setCommentList(
				currentComments.map((item) =>
					item.id === comment.id ? comment : item,
				),
			);
		}

		setReplyDrafts((current) => ({
			...current,
			[comment.id]: comment.replyBody ?? current[comment.id] ?? "",
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
		const pendingKey = actionKey(comment, Object.keys(body).join(","));
		beginAction(pendingKey);
		setListError(null);
		try {
			const response = await apiPut<{ comment: Omit<AdminComment, "post"> }>(
				`/api/admin/posts/${encodeURIComponent(
					comment.post.id,
				)}/comments/${encodeURIComponent(comment.id)}`,
				body,
				csrfToken,
			);
			const updatedComment = commentFromUpdate(comment, response.comment);
			if (Object.prototype.hasOwnProperty.call(body, "replyBody")) {
				clearReplyDraftDirty(comment.id);
			}
			replaceComment(comment, updatedComment);
			refreshCommentList();
			setToast(successMessage);
		} catch (error) {
			setListError(errorMessage(error, "Comment could not be updated."));
		} finally {
			endAction(pendingKey);
		}
	}

	async function deleteComment(comment: AdminComment) {
		const pendingKey = actionKey(comment, "delete");
		beginAction(pendingKey);
		setListError(null);
		try {
			await apiDelete(
				`/api/admin/posts/${encodeURIComponent(
					comment.post.id,
				)}/comments/${encodeURIComponent(comment.id)}`,
				csrfToken,
			);
			const currentComments = commentsRef.current;
			if (currentComments.some((item) => item.id === comment.id)) {
				setCommentList(currentComments.filter((item) => item.id !== comment.id));
				decrementVisibleTotal();
			}
			clearReplyDraftDirty(comment.id);
			refreshCommentList();
			setToast("Comment deleted.");
		} catch (error) {
			setListError(errorMessage(error, "Comment could not be deleted."));
		} finally {
			endAction(pendingKey);
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
						disabled={settingsControlsDisabled}
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
						disabled={settingsControlsDisabled}
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
						disabled={settingsControlsDisabled}
						onChange={(event) =>
							setModerationCommentsEnabled(event.currentTarget.checked)
						}
					/>
					Review comments before publishing
				</label>
				<div className="admin-inline-actions">
					<button
						type="button"
						disabled={settingsControlsDisabled}
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
				<p className="admin-note">{listSummary}</p>
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
													isRowPending(comment.id)
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
												listPending ||
												isRowPending(comment.id)
											}
											onClick={() => deleteComment(comment)}
										>
											{isActionPending(actionKey(comment, "delete"))
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
										disabled={
											listPending ||
											isRowPending(comment.id)
										}
										onChange={(event) => {
											const nextReply = event.currentTarget.value;
											markReplyDraftDirty(comment.id);
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
											isRowPending(comment.id)
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
						onClick={() => {
							const nextPage = Math.max(1, pageRef.current - 1);
							pageRef.current = nextPage;
							setPage(nextPage);
						}}
					>
						Previous
					</button>
					<span>
						Page {page} of {pageCount}
					</span>
					<button
						type="button"
						disabled={listPending || page >= pageCount}
						onClick={() => {
							const nextPage = pageRef.current + 1;
							pageRef.current = nextPage;
							setPage(nextPage);
						}}
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
