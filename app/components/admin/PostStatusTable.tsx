import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../../lib/api-client";
import {
	LocalPostEditor,
	type LocalPostDraft,
} from "./LocalPostEditor";

type AdminPostRecord = {
	id: string;
	sourceType?: "notion" | "local" | null;
	sourceId?: string | null;
	title?: string | null;
	slug?: string | null;
	status?: string | null;
	visibility?: string | null;
	manualVisibility?: "visible" | "hidden" | null;
	locked?: boolean | null;
	commentsEnabled?: boolean | null;
	albumMediaEnabled?: boolean | null;
	sectionId?: string | null;
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
	| "delete"
	| "album-on"
	| "album-off"
	| "resync";

type CommentSettingsResponse = {
	defaultEnabled: boolean;
	globalEnabled: boolean;
	moderationEnabled?: boolean;
};

type AdminPostComment = {
	id: string;
	nickname: string;
	body: string;
	moderationStatus: "pending" | "approved";
	replyBody: string | null;
	replyCreatedAt: string | null;
	createdAt: string;
};

type AdminPostCommentsResponse = {
	post: {
		id: string;
		title: string;
		commentsEnabled: boolean;
	};
	comments: AdminPostComment[];
};

type AdminPostSection = {
	id: string;
	name: string;
	slug: string;
	sortOrder: number;
	postCount?: number;
};

type AdminPostSectionsResponse = {
	items: AdminPostSection[];
};

type LocalPostDraftResponse = {
	draft: LocalPostDraft;
};

type PostStatusTableProps = {
	csrfToken: string;
	editorDraftId?: string | null;
	immersive?: boolean;
	onEditorDraftIdChange?: (draftId: string | null) => void;
	onImmersiveChange?: (immersive: boolean) => void;
};

type LocalPostDraftsResponse = {
	items: LocalPostDraft[];
};

const pageSize = 20;
const noSectionFilterValue = "__none__";
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
	delete: "deleted",
	"album-on": "album media enabled",
	"album-off": "album media disabled",
	resync: "resync queued",
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

function draftTitle(draft: LocalPostDraft): string {
	return draft.title?.trim() || "Untitled draft";
}

function postHref(post: AdminPostRecord): string {
	const slug = post.slug?.trim();
	return slug ? `/post/${encodeURIComponent(slug)}` : "#";
}

function postSourceLabel(post: AdminPostRecord): string {
	return post.sourceType ?? "notion";
}

function sectionLabel(
	sections: AdminPostSection[],
	sectionId?: string | null,
): string {
	if (!sectionId) {
		return "No section";
	}

	return sections.find((section) => section.id === sectionId)?.name ?? "Unknown";
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

function formatCommentDate(value: string): string {
	return formatDate(value);
}

function postStateTags(post: AdminPostRecord): string[] {
	const tags = [post.visibility ?? "unknown"];
	if (post.manualVisibility === "hidden") {
		tags.push("hidden");
	}
	if (post.locked === true) {
		tags.push("locked");
	}
	if (post.commentsEnabled === false) {
		tags.push("comments off");
	}

	return tags;
}

function sortOptionFor(value: string): SortOption {
	return sortOptions.find((option) => option.value === value) ?? sortOptions[0];
}

function buildPostsPath({
	page,
	q,
	status,
	sectionId,
	sort,
}: {
	page: number;
	q: string;
	status: string;
	sectionId: string;
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
	if (sectionId.trim()) {
		params.set("sectionId", sectionId.trim());
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

export function PostStatusTable({
	csrfToken,
	editorDraftId,
	immersive,
	onEditorDraftIdChange,
	onImmersiveChange,
}: PostStatusTableProps) {
	const [posts, setPosts] = useState<AdminPostRecord[]>([]);
	const [status, setStatus] = useState("Loading post status...");
	const [error, setError] = useState<string | null>(null);
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [titleKeyword, setTitleKeyword] = useState("");
	const [appliedTitleKeyword, setAppliedTitleKeyword] = useState("");
	const [statusFilter, setStatusFilter] = useState("");
	const [appliedStatusFilter, setAppliedStatusFilter] = useState("");
	const [sectionFilter, setSectionFilter] = useState("");
	const [appliedSectionFilter, setAppliedSectionFilter] = useState("");
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
	const [managedPost, setManagedPost] = useState<AdminPostRecord | null>(null);
	const [sectionSettingsOpen, setSectionSettingsOpen] = useState(false);
	const [commentsDialogPost, setCommentsDialogPost] =
		useState<AdminPostRecord | null>(null);
	const [sections, setSections] = useState<AdminPostSection[]>([]);
	const [sectionDrafts, setSectionDrafts] = useState<
		Record<string, { name: string; slug: string }>
	>({});
	const [newSectionName, setNewSectionName] = useState("");
	const [newSectionSlug, setNewSectionSlug] = useState("");
	const [sectionSettingsStatus, setSectionSettingsStatus] =
		useState("Loading sections...");
	const [sectionActionPending, setSectionActionPending] = useState<string | null>(
		null,
	);
	const [sectionDeleteDialog, setSectionDeleteDialog] =
		useState<AdminPostSection | null>(null);
	const [lockPassword, setLockPassword] = useState("");
	const [globalCommentsEnabled, setGlobalCommentsEnabled] = useState(true);
	const [postComments, setPostComments] = useState<AdminPostComment[]>([]);
	const [postCommentReplies, setPostCommentReplies] = useState<
		Record<string, string>
	>({});
	const [postCommentsEnabled, setPostCommentsEnabled] = useState(true);
	const [postCommentsLoading, setPostCommentsLoading] = useState(false);
	const [postCommentsSaving, setPostCommentsSaving] = useState(false);
	const [postCommentsUpdating, setPostCommentsUpdating] = useState<string | null>(
		null,
	);
	const [postCommentsDeleting, setPostCommentsDeleting] = useState<string | null>(
		null,
	);
	const [postCommentsError, setPostCommentsError] = useState<string | null>(null);
	const [editorDraft, setEditorDraft] = useState<LocalPostDraft | null>(null);
	const [localDrafts, setLocalDrafts] = useState<LocalPostDraft[]>([]);
	const [openingDraftId, setOpeningDraftId] = useState<string | null>(null);
	const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
	const [draftsError, setDraftsError] = useState<string | null>(null);
	const [creatingDraft, setCreatingDraft] = useState(false);

	const pageCount = useMemo(
		() => Math.max(1, Math.ceil(total / pageSize)),
		[total],
	);
	const hasEditorRoute = editorDraftId !== undefined;
	const activeManagedPost = managedPost
		? (posts.find((post) => post.id === managedPost.id) ?? managedPost)
		: null;
	const sectionSettingsContent = (
		<>
			<form
				className="admin-form admin-section-create-form"
				onSubmit={createPostSection}
			>
				<label>
					New section name
					<input
						type="text"
						value={newSectionName}
						onChange={(event) =>
							setNewSectionName(event.currentTarget.value)
						}
					/>
				</label>
				<label>
					New section slug
					<input
						type="text"
						value={newSectionSlug}
						onChange={(event) =>
							setNewSectionSlug(event.currentTarget.value)
						}
					/>
				</label>
				<button type="submit" disabled={sectionActionPending === "create"}>
					{sectionActionPending === "create" ? "Adding..." : "Add section"}
				</button>
			</form>
			{sections.length > 0 ? (
				<div className="admin-section-list">
					{sections.map((section, index) => {
						const draft = sectionDrafts[section.id] ?? {
							name: section.name,
							slug: section.slug,
						};
						return (
							<article className="admin-section-card" key={section.id}>
								<div className="admin-section-card-fields">
									<label>
										<span>Name</span>
										<input
											aria-label={`Name for ${section.name}`}
											value={draft.name}
											onChange={(event) =>
												setSectionDrafts((current) => ({
													...current,
													[section.id]: {
														...draft,
														name: event.currentTarget.value,
													},
												}))
											}
										/>
									</label>
									<label>
										<span>Slug</span>
										<input
											aria-label={`Slug for ${section.name}`}
											value={draft.slug}
											onChange={(event) =>
												setSectionDrafts((current) => ({
													...current,
													[section.id]: {
														...draft,
														slug: event.currentTarget.value,
													},
												}))
											}
										/>
									</label>
									<span className="admin-muted-text">
										{section.postCount ?? 0} posts
									</span>
								</div>
								<div className="admin-section-card-actions">
									<button
										type="button"
										className="admin-secondary-button"
										disabled={
											index === 0 ||
											sectionActionPending === `${section.id}:up`
										}
										onClick={() => void movePostSection(section, "up")}
									>
										Up
									</button>
									<button
										type="button"
										className="admin-secondary-button"
										disabled={
											index === sections.length - 1 ||
											sectionActionPending === `${section.id}:down`
										}
										onClick={() => void movePostSection(section, "down")}
									>
										Down
									</button>
									<button
										type="button"
										disabled={
											sectionActionPending === `${section.id}:save`
										}
										onClick={() => void savePostSection(section)}
									>
										Save
									</button>
									<button
										type="button"
										className="danger-link"
										disabled={
											sectionActionPending === `${section.id}:delete`
										}
										onClick={() => void deletePostSection(section)}
									>
										Delete
									</button>
								</div>
							</article>
						);
					})}
				</div>
			) : (
				<p className="admin-note">No sections yet.</p>
			)}
			<p className="admin-note">{sectionSettingsStatus}</p>
		</>
	);

	useEffect(() => {
		let cancelled = false;

		apiGet<CommentSettingsResponse>("/api/admin/posts/comment-settings")
			.then((response) => {
				if (cancelled) {
					return;
				}

				setGlobalCommentsEnabled(response.globalEnabled);
			})
			.catch(() => undefined);

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		setSectionSettingsStatus("Loading sections...");

		apiGet<AdminPostSectionsResponse>("/api/admin/post-sections")
			.then((response) => {
				if (cancelled) {
					return;
				}

				const items = (response.items ?? []).sort(
					(left, right) => left.sortOrder - right.sortOrder,
				);
				setSections(items);
				setSectionDrafts(
					Object.fromEntries(
						items.map((section) => [
							section.id,
							{ name: section.name, slug: section.slug },
						]),
					),
				);
				setSectionSettingsStatus("Section settings loaded.");
			})
			.catch((loadError: unknown) => {
				if (!cancelled) {
					setSections([]);
					setSectionDrafts({});
					setSectionSettingsStatus(
						loadError instanceof Error
							? loadError.message
							: "Sections could not be loaded.",
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
			sectionId: appliedSectionFilter,
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
	}, [
		page,
		appliedTitleKeyword,
		appliedStatusFilter,
		appliedSectionFilter,
		appliedSort,
	]);

	useEffect(() => {
		let cancelled = false;

		apiGet<LocalPostDraftsResponse>("/api/admin/local-posts")
			.then((response) => {
				if (cancelled) {
					return;
				}

				setLocalDrafts(
					response.items.filter((draft) => draft.status === "draft"),
				);
				setDraftsError(null);
			})
			.catch((loadError: unknown) => {
				if (!cancelled) {
					setLocalDrafts([]);
					setDraftsError(
						loadError instanceof Error
							? loadError.message
							: "Local drafts could not be loaded.",
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!hasEditorRoute) {
			return;
		}
		if (!editorDraftId) {
			setEditorDraft(null);
			return;
		}
		if (editorDraft?.id === editorDraftId) {
			return;
		}

		let cancelled = false;
		setOpeningDraftId(editorDraftId);
		setError(null);
		setToast(null);

		apiGet<LocalPostDraftResponse>(
			`/api/admin/local-posts/${encodeURIComponent(editorDraftId)}`,
		)
			.then((response) => {
				if (cancelled) {
					return;
				}

				rememberLocalDraft(response.draft);
				setEditorDraft(response.draft);
			})
			.catch((openError: unknown) => {
				if (!cancelled) {
					setEditorDraft(null);
					setError(
						openError instanceof Error
							? openError.message
							: "Local draft could not be opened.",
					);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setOpeningDraftId(null);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [editorDraft?.id, editorDraftId, hasEditorRoute]);

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
		setAppliedSectionFilter(sectionFilter);
		setAppliedSort(sort);
		setPage(1);
	}

	async function refreshPostsForCurrentView() {
		setStatus("Loading post status...");
		setError(null);

		try {
			const response = await apiGet<PostsResponse>(
				buildPostsPath({
					page,
					q: appliedTitleKeyword,
					status: appliedStatusFilter,
					sectionId: appliedSectionFilter,
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
		} catch (loadError) {
			setPosts([]);
			setTotal(0);
			setError(
				loadError instanceof Error
					? loadError.message
					: "Post status endpoint is not available.",
			);
			setStatus("Posts could not be loaded.");
		}
	}

	async function refreshLocalDrafts() {
		try {
			const response =
				await apiGet<LocalPostDraftsResponse>("/api/admin/local-posts");
			setLocalDrafts(response.items.filter((draft) => draft.status === "draft"));
			setDraftsError(null);
		} catch (loadError) {
			setLocalDrafts([]);
			setDraftsError(
				loadError instanceof Error
					? loadError.message
					: "Local drafts could not be loaded.",
			);
		}
	}

	function rememberLocalDraft(draft: LocalPostDraft) {
		setLocalDrafts((current) => {
			const next = current.filter((item) => item.id !== draft.id);
			if (draft.status === "draft") {
				next.unshift(draft);
			}

			return next.sort(
				(left, right) =>
					new Date(right.updatedAt).getTime() -
					new Date(left.updatedAt).getTime(),
			);
		});
	}

	async function createLocalDraft() {
		setCreatingDraft(true);
		setError(null);
		setToast(null);

		try {
			const response = await apiPost<LocalPostDraftResponse>(
				"/api/admin/local-posts",
				{
					title: "Untitled draft",
					slug: null,
					excerpt: "",
					markdown: "",
					coverUrl: null,
					category: null,
					tags: [],
					commentsEnabled: null,
					publishedAt: null,
				},
				csrfToken,
			);
			rememberLocalDraft(response.draft);
			setEditorDraft(response.draft);
			onEditorDraftIdChange?.(response.draft.id);
		} catch (createError) {
			setError(
				createError instanceof Error
					? createError.message
					: "Local draft could not be created.",
			);
		} finally {
			setCreatingDraft(false);
		}
	}

	async function openLocalDraft(draftId: string) {
		if (onEditorDraftIdChange) {
			onEditorDraftIdChange(draftId);
			return;
		}

		setOpeningDraftId(draftId);
		setError(null);
		setToast(null);

		try {
			const response = await apiGet<LocalPostDraftResponse>(
				`/api/admin/local-posts/${encodeURIComponent(draftId)}`,
			);
			rememberLocalDraft(response.draft);
			setEditorDraft(response.draft);
		} catch (openError) {
			setError(
				openError instanceof Error
					? openError.message
					: "Local draft could not be opened.",
			);
		} finally {
			setOpeningDraftId(null);
		}
	}

	async function deleteLocalDraftFromList(draft: LocalPostDraft) {
		setDeletingDraftId(draft.id);
		setDraftsError(null);
		setError(null);
		setToast(null);

		try {
			await apiDelete<{ ok: true }>(
				`/api/admin/local-posts/${encodeURIComponent(draft.id)}`,
				csrfToken,
			);
			setLocalDrafts((current) =>
				current.filter((item) => item.id !== draft.id),
			);
			if (editorDraft?.id === draft.id) {
				setEditorDraft(null);
				onEditorDraftIdChange?.(null);
			}
			setToast("Draft deleted.");
		} catch (deleteError) {
			setDraftsError(
				deleteError instanceof Error
					? deleteError.message
					: `${draftTitle(draft)} could not be deleted.`,
			);
		} finally {
			setDeletingDraftId(null);
		}
	}

	async function editLocalPost(post: AdminPostRecord) {
		setActionPending(`${post.id}:edit`);
		setError(null);
		setToast(null);

		try {
			const response = await apiPost<LocalPostDraftResponse>(
				"/api/admin/local-posts",
				{ postId: post.id },
				csrfToken,
			);
			setEditorDraft(response.draft);
			onEditorDraftIdChange?.(response.draft.id);
		} catch (editError) {
			setError(
				editError instanceof Error
					? editError.message
					: "Local post could not be opened.",
			);
		} finally {
			setActionPending(null);
		}
	}

	function rememberSection(section: AdminPostSection) {
		setSections((current) =>
			[
				...current.filter((item) => item.id !== section.id),
				section,
			].sort((left, right) => left.sortOrder - right.sortOrder),
		);
		setSectionDrafts((current) => ({
			...current,
			[section.id]: { name: section.name, slug: section.slug },
		}));
	}

	async function createPostSection(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSectionActionPending("create");
		setSectionSettingsStatus("Creating section...");
		try {
			const response = await apiPost<{ section: AdminPostSection }>(
				"/api/admin/post-sections",
				{ name: newSectionName, slug: newSectionSlug },
				csrfToken,
			);
			rememberSection(response.section);
			setNewSectionName("");
			setNewSectionSlug("");
			setSectionSettingsStatus("Section created.");
			setToast("Section created.");
		} catch (error) {
			setSectionSettingsStatus(
				error instanceof Error ? error.message : "Section could not be created.",
			);
		} finally {
			setSectionActionPending(null);
		}
	}

	async function savePostSection(section: AdminPostSection) {
		const draft = sectionDrafts[section.id] ?? {
			name: section.name,
			slug: section.slug,
		};
		setSectionActionPending(`${section.id}:save`);
		setSectionSettingsStatus("Saving section...");
		try {
			const response = await apiPut<{ section: AdminPostSection }>(
				`/api/admin/post-sections/${encodeURIComponent(section.id)}`,
				draft,
				csrfToken,
			);
			rememberSection(response.section);
			setSectionSettingsStatus("Section saved.");
			setToast("Section saved.");
		} catch (error) {
			setSectionSettingsStatus(
				error instanceof Error ? error.message : "Section could not be saved.",
			);
		} finally {
			setSectionActionPending(null);
		}
	}

	async function movePostSection(
		section: AdminPostSection,
		direction: "up" | "down",
	) {
		setSectionActionPending(`${section.id}:${direction}`);
		setSectionSettingsStatus("Reordering sections...");
		try {
			await apiPost<{ section: AdminPostSection }>(
				`/api/admin/post-sections/${encodeURIComponent(section.id)}/move`,
				{ direction },
				csrfToken,
			);
			const response =
				await apiGet<AdminPostSectionsResponse>("/api/admin/post-sections");
			const items = response.items.sort(
				(left, right) => left.sortOrder - right.sortOrder,
			);
			setSections(items);
			setSectionDrafts(
				Object.fromEntries(
					items.map((item) => [item.id, { name: item.name, slug: item.slug }]),
				),
			);
			setSectionSettingsStatus("Sections reordered.");
		} catch (error) {
			setSectionSettingsStatus(
				error instanceof Error
					? error.message
					: "Sections could not be reordered.",
			);
		} finally {
			setSectionActionPending(null);
		}
	}

	async function deletePostSection(section: AdminPostSection, confirmed = false) {
		if (!confirmed && (section.postCount ?? 0) > 0) {
			setSectionDeleteDialog(section);
			return;
		}

		setSectionActionPending(`${section.id}:delete`);
		setSectionSettingsStatus("Deleting section...");
		try {
			await apiDelete(
				`/api/admin/post-sections/${encodeURIComponent(section.id)}${
					confirmed ? "?movePosts=none" : ""
				}`,
				csrfToken,
			);
			setSections((current) => current.filter((item) => item.id !== section.id));
			setSectionDrafts((current) => {
				const next = { ...current };
				delete next[section.id];
				return next;
			});
			setPosts((current) =>
				current.map((post) =>
					post.sectionId === section.id ? { ...post, sectionId: null } : post,
				),
			);
			setManagedPost((current) =>
				current?.sectionId === section.id
					? { ...current, sectionId: null }
					: current,
			);
			setSectionDeleteDialog(null);
			setSectionSettingsStatus("Section deleted.");
			setToast("Section deleted.");
		} catch (error) {
			if (!confirmed && error instanceof Error && error.message.includes("assigned posts")) {
				setSectionDeleteDialog(section);
			}
			setSectionSettingsStatus(
				error instanceof Error ? error.message : "Section could not be deleted.",
			);
		} finally {
			setSectionActionPending(null);
		}
	}

	async function updatePostSection(post: AdminPostRecord, sectionId: string | null) {
		setActionPending(`${post.id}:section`);
		setError(null);
		try {
			const response = await apiPut<{ post: { id: string; sectionId: string | null } }>(
				`/api/admin/posts/${encodeURIComponent(post.id)}/section`,
				{ sectionId },
				csrfToken,
			);
			refreshPostInList(post.id, { sectionId: response.post.sectionId });
			setToast(`${postTitle(post)} section updated.`);
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "Post section could not be saved.",
			);
		} finally {
			setActionPending(null);
		}
	}

	function refreshPostInList(postId: string, updates: Partial<AdminPostRecord>) {
		setPosts((current) =>
			current.map((post) =>
				post.id === postId
					? {
							...post,
							...updates,
						}
					: post,
			),
		);
		setManagedPost((current) =>
			current?.id === postId
				? {
						...current,
						...updates,
					}
				: current,
		);
		setCommentsDialogPost((current) =>
			current?.id === postId
				? {
						...current,
						...updates,
					}
				: current,
		);
	}

	async function openCommentsDialog(post: AdminPostRecord) {
		setCommentsDialogPost(post);
		setPostComments([]);
		setPostCommentReplies({});
		setPostCommentsEnabled(post.commentsEnabled !== false);
		setPostCommentsLoading(true);
		setPostCommentsError(null);

		try {
			const response = await apiGet<AdminPostCommentsResponse>(
				`/api/admin/posts/${encodeURIComponent(post.id)}/comments`,
			);
			setPostComments(response.comments);
			setPostCommentReplies(
				Object.fromEntries(
					response.comments.map((comment) => [
						comment.id,
						comment.replyBody ?? "",
					]),
				),
			);
			setPostCommentsEnabled(response.post.commentsEnabled);
			refreshPostInList(post.id, {
				title: response.post.title,
				commentsEnabled: response.post.commentsEnabled,
			});
		} catch (error) {
			setPostCommentsError(
				error instanceof Error ? error.message : "Comments could not be loaded.",
			);
		} finally {
			setPostCommentsLoading(false);
		}
	}

	async function savePostCommentsSetting() {
		if (!commentsDialogPost) {
			return;
		}

		setPostCommentsSaving(true);
		setPostCommentsError(null);
		try {
			const response = await apiPut<Pick<AdminPostCommentsResponse, "post">>(
				`/api/admin/posts/${encodeURIComponent(commentsDialogPost.id)}/comments`,
				{ enabled: postCommentsEnabled },
				csrfToken,
			);
			refreshPostInList(commentsDialogPost.id, {
				commentsEnabled: response.post.commentsEnabled,
			});
			setPostCommentsEnabled(response.post.commentsEnabled);
			setToast(`${postTitle(commentsDialogPost)} comments updated.`);
		} catch (error) {
			setPostCommentsError(
				error instanceof Error
					? error.message
					: "Comment setting could not be saved.",
			);
		} finally {
			setPostCommentsSaving(false);
		}
	}

	async function deletePostComment(comment: AdminPostComment) {
		if (!commentsDialogPost) {
			return;
		}

		setPostCommentsDeleting(comment.id);
		setPostCommentsError(null);
		try {
			await apiDelete(
				`/api/admin/posts/${encodeURIComponent(
					commentsDialogPost.id,
				)}/comments/${encodeURIComponent(comment.id)}`,
				csrfToken,
			);
			setPostComments((current) =>
				current.filter((item) => item.id !== comment.id),
			);
			setToast("Comment deleted.");
		} catch (error) {
			setPostCommentsError(
				error instanceof Error ? error.message : "Comment could not be deleted.",
			);
		} finally {
			setPostCommentsDeleting(null);
		}
	}

	async function updatePostComment(
		comment: AdminPostComment,
		body: { moderationStatus?: "pending" | "approved"; replyBody?: string | null },
		successMessage: string,
	) {
		if (!commentsDialogPost) {
			return;
		}

		setPostCommentsUpdating(`${comment.id}:${Object.keys(body).join(",")}`);
		setPostCommentsError(null);
		try {
			const response = await apiPut<{ comment: AdminPostComment }>(
				`/api/admin/posts/${encodeURIComponent(
					commentsDialogPost.id,
				)}/comments/${encodeURIComponent(comment.id)}`,
				body,
				csrfToken,
			);
			setPostComments((current) =>
				current.map((item) =>
					item.id === comment.id ? response.comment : item,
				),
			);
			setPostCommentReplies((current) => ({
				...current,
				[comment.id]: response.comment.replyBody ?? "",
			}));
			setToast(successMessage);
		} catch (error) {
			setPostCommentsError(
				error instanceof Error ? error.message : "Comment could not be updated.",
			);
		} finally {
			setPostCommentsUpdating(null);
		}
	}

	function approvePostComment(comment: AdminPostComment) {
		void updatePostComment(
			comment,
			{ moderationStatus: "approved" },
			"Comment approved.",
		);
	}

	function savePostCommentReply(comment: AdminPostComment) {
		void updatePostComment(
			comment,
			{ replyBody: postCommentReplies[comment.id] ?? "" },
			"Reply saved.",
		);
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
			const actionResponse = await apiPost<{ runId?: string }>(
				`/api/admin/posts/${encodeURIComponent(post.id)}/${action}`,
				action === "lock" ? { password } : {},
				csrfToken,
			);
			if (action === "hide" || action === "restore") {
				setToast(`${title} ${actionLabels[action]}.`);
			}
			if (action === "album-on" || action === "album-off") {
				setToast(`${title} ${actionLabels[action]}.`);
			}
			if (action === "resync") {
				setToast(
					`${title} resync queued${
						actionResponse.runId ? `: ${actionResponse.runId}` : ""
					}.`,
				);
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
				setManagedPost(null);
			}
			await refreshPostsForCurrentView();
		} catch (actionError) {
			setError(
				actionError instanceof Error ? actionError.message : "Post action failed.",
			);
		} finally {
			setActionPending(null);
		}
	}

	function handleEditorDraftChange(draft: LocalPostDraft) {
		setEditorDraft(draft);
		rememberLocalDraft(draft);
	}

	if (editorDraftId && !editorDraft && openingDraftId === editorDraftId) {
		return (
			<section className="admin-module">
				<h2>Opening editor</h2>
				<p className="admin-note">Loading local draft...</p>
			</section>
		);
	}

	if (editorDraft) {
		return (
			<LocalPostEditor
				csrfToken={csrfToken}
				draft={editorDraft}
				immersive={immersive}
				onImmersiveChange={onImmersiveChange}
				onBack={() => {
					setEditorDraft(null);
					onEditorDraftIdChange?.(null);
					void refreshLocalDrafts();
				}}
				onDraftChange={handleEditorDraftChange}
				onPublished={async () => {
					setEditorDraft(null);
					onEditorDraftIdChange?.(null);
					await Promise.all([
						refreshPostsForCurrentView(),
						refreshLocalDrafts(),
					]);
					setToast("Local post published.");
				}}
			/>
		);
	}

	return (
		<div className="admin-stack admin-posts-page">
			<section className="admin-post-workbench">
				<div>
					<h2>Posts</h2>
				</div>
				<div className="admin-post-workbench-actions">
					<div className="admin-post-summary-grid" aria-label="Post summary">
						<span>
							<strong>{total}</strong>
							posts
						</span>
						<span>
							<strong>{localDrafts.length}</strong>
							drafts
						</span>
						<span>
							<strong>{globalCommentsEnabled ? "On" : "Off"}</strong>
							comments
						</span>
					</div>
					<div className="admin-section-actions admin-post-toolbar-actions">
						<button
							type="button"
							className="admin-secondary-button"
							aria-expanded={sectionSettingsOpen}
							onClick={() => setSectionSettingsOpen(true)}
						>
							Section settings
						</button>
						<button
							type="button"
							disabled={creatingDraft}
							onClick={() => void createLocalDraft()}
						>
							{creatingDraft ? "Creating..." : "New post"}
						</button>
					</div>
				</div>
			</section>

			{localDrafts.length > 0 || draftsError ? (
				<section className="admin-module admin-drafts-strip">
					<div>
						<h3>Local drafts</h3>
					</div>
					{draftsError ? <p className="admin-error">{draftsError}</p> : null}
					{localDrafts.length > 0 ? (
						<div className="admin-draft-cards">
							{localDrafts.slice(0, 4).map((draft) => {
								const title = draftTitle(draft);
								const deleting = deletingDraftId === draft.id;
								return (
									<article className="admin-draft-card" key={draft.id}>
										<button
											type="button"
											className="admin-draft-delete-button"
											aria-label={`Delete ${title}`}
											disabled={deleting}
											onClick={() => void deleteLocalDraftFromList(draft)}
										>
											<svg
												aria-hidden="true"
												focusable="false"
												viewBox="0 0 24 24"
											>
												<path d="M4 7h16" />
												<path d="M10 11v6" />
												<path d="M14 11v6" />
												<path d="M6 7l1 14h10l1-14" />
												<path d="M9 7V4h6v3" />
											</svg>
										</button>
										<div className="admin-draft-card-content">
											<strong>{title}</strong>
											<span>{draft.slug ?? "No slug"}</span>
											<time dateTime={draft.updatedAt}>
												{formatDate(draft.updatedAt)}
											</time>
										</div>
										<button
											type="button"
											aria-label={`Open ${title}`}
											disabled={openingDraftId === draft.id || deleting}
											onClick={() => void openLocalDraft(draft.id)}
										>
											{openingDraftId === draft.id ? "Opening..." : "Open"}
										</button>
									</article>
								);
							})}
							{localDrafts.length > 4 ? (
								<p className="admin-drafts-overflow">
									{localDrafts.length - 4} more draft
									{localDrafts.length - 4 === 1 ? "" : "s"} in this queue.
								</p>
							) : null}
						</div>
					) : null}
				</section>
			) : null}

			<div className="admin-post-workspace">
				<section className="admin-module admin-post-list-module">
					<form className="admin-form admin-post-filters" onSubmit={applyFilters}>
						<label>
							Title keyword
							<input
								type="search"
								placeholder="Search title"
								value={titleKeyword}
								onChange={(event) => setTitleKeyword(event.currentTarget.value)}
							/>
						</label>
						<label>
							Status
							<input
								type="search"
								placeholder="Published, draft, hidden"
								value={statusFilter}
								onChange={(event) => setStatusFilter(event.currentTarget.value)}
							/>
						</label>
						<label>
							Section
							<select
								value={sectionFilter}
								onChange={(event) =>
									setSectionFilter(event.currentTarget.value)
								}
							>
								<option value="">All sections</option>
								<option value={noSectionFilterValue}>No section</option>
								{sections.map((section) => (
									<option key={section.id} value={section.id}>
										{section.name}
									</option>
								))}
							</select>
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

					<div className="admin-post-list-status">
						<p className="admin-note">{status}</p>
						{error ? <p className="admin-error">{error}</p> : null}
					</div>

					{posts.length > 0 ? (
						<div className="admin-table-wrap">
							<table className="admin-table admin-post-table">
								<thead>
									<tr>
										<th>Post</th>
										<th>State</th>
										<th>Updated</th>
										<th>Sync</th>
										<th>Manage</th>
									</tr>
								</thead>
								<tbody>
									{posts.map((post) => {
										const title = postTitle(post);
										const isSelected = activeManagedPost?.id === post.id;

										return (
											<tr
												key={post.id}
												className={isSelected ? "selected" : undefined}
											>
												<td data-label="Post">
													<a
														className="admin-post-title-link"
														href={postHref(post)}
													>
														{title}
													</a>
													<div className="admin-post-row-meta">
														<span>{postSourceLabel(post)}</span>
														<span>{post.slug ?? "No slug"}</span>
													</div>
												</td>
												<td data-label="State">
													<div className="admin-state-tags">
														{postStateTags(post).map((tag) => (
															<span key={tag}>{tag}</span>
														))}
													</div>
												</td>
												<td data-label="Updated">
													{formatDate(post.notionLastEditedTime ?? post.updatedAt)}
												</td>
												<td data-label="Sync">
													{post.lastSyncError ? (
														<span className="admin-sync-error">
															{post.lastSyncError}
														</span>
													) : (
														<span className="admin-muted-text">Healthy</span>
													)}
												</td>
												<td className="admin-actions-cell" data-label="Manage">
													<button
														type="button"
														className="admin-secondary-button"
														aria-pressed={isSelected}
														onClick={() => setManagedPost(post)}
													>
														Manage
													</button>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					) : (
						<div className="admin-empty-state">
							<h3>No posts in this view</h3>
						</div>
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

			</div>
			{sectionSettingsOpen ? (
				<div className="admin-modal-backdrop">
					<div
						className="admin-modal admin-settings-modal admin-post-section-settings"
						role="dialog"
						aria-label="Section settings"
						aria-modal="true"
					>
						<div className="admin-post-manager-heading">
							<div>
								<p className="admin-eyebrow">Settings</p>
								<h3>Section settings</h3>
							</div>
							<button
								type="button"
								className="admin-action-icon"
								aria-label="Close section settings"
								onClick={() => setSectionSettingsOpen(false)}
							>
								Close
							</button>
						</div>
						{sectionSettingsContent}
					</div>
				</div>
			) : null}
			{activeManagedPost ? (
				<div className="admin-modal-backdrop">
					<div
						className="admin-modal admin-management-modal admin-post-manager"
						role="dialog"
						aria-label="Post management"
						aria-modal="true"
					>
							<div className="admin-post-manager-heading">
								<div>
									<p className="admin-eyebrow">Manage post</p>
									<h3>{postTitle(activeManagedPost)}</h3>
								</div>
								<button
									type="button"
									className="admin-action-icon"
									aria-label="Close post management"
									onClick={() => setManagedPost(null)}
								>
									Close
								</button>
							</div>
							<div className="admin-post-manager-meta">
								<span>{postSourceLabel(activeManagedPost)}</span>
								<span>{activeManagedPost.slug ?? "No slug"}</span>
								<span>
									Section{" "}
									{sectionLabel(sections, activeManagedPost.sectionId)}
								</span>
								<span>
									Updated{" "}
									{formatDate(
										activeManagedPost.notionLastEditedTime ??
											activeManagedPost.updatedAt,
									)}
								</span>
							</div>
							<div className="admin-state-tags">
								{postStateTags(activeManagedPost).map((tag) => (
									<span key={tag}>{tag}</span>
								))}
							</div>
							{activeManagedPost.lastSyncError ? (
								<p className="admin-sync-callout">
									<strong>Sync error</strong>
									<span>{activeManagedPost.lastSyncError}</span>
								</p>
							) : null}
							<div className="admin-manager-section">
								<h4>Visibility</h4>
								<div className="admin-manager-actions">
									<button
										type="button"
										disabled={
											actionPending ===
											`${activeManagedPost.id}:${
												activeManagedPost.manualVisibility === "hidden"
													? "restore"
													: "hide"
											}`
										}
										onClick={() =>
											runAction(
												activeManagedPost,
												activeManagedPost.manualVisibility === "hidden"
													? "restore"
													: "hide",
											)
										}
									>
										{activeManagedPost.manualVisibility === "hidden"
											? "Restore"
											: "Hide"}
									</button>
									{activeManagedPost.locked ? (
										<button
											type="button"
											disabled={
												actionPending === `${activeManagedPost.id}:unlock`
											}
											onClick={() => runAction(activeManagedPost, "unlock")}
										>
											Unlock
										</button>
									) : (
										<button
											type="button"
											disabled={actionPending === `${activeManagedPost.id}:lock`}
											onClick={() => {
												setLockPassword("");
												setLockDialogPost(activeManagedPost);
											}}
										>
											Lock
										</button>
									)}
									{activeManagedPost.locked && activeManagedPost.lockPassword ? (
										<button
											type="button"
											className="admin-secondary-button"
											onClick={() => setPasswordDialogPost(activeManagedPost)}
										>
											Show password
										</button>
									) : null}
								</div>
							</div>
							<div className="admin-manager-section">
								<h4>Comments and source</h4>
								<div className="admin-manager-actions">
									<button
										type="button"
										onClick={() => openCommentsDialog(activeManagedPost)}
									>
										Comments
									</button>
									{activeManagedPost.sourceType === "local" ? (
										<button
											type="button"
											disabled={
												actionPending === `${activeManagedPost.id}:edit`
											}
											onClick={() => void editLocalPost(activeManagedPost)}
										>
											Edit
										</button>
									) : (
										<button
											type="button"
											disabled={
												actionPending === `${activeManagedPost.id}:resync`
											}
											onClick={() => runAction(activeManagedPost, "resync")}
										>
											Resync
										</button>
									)}
								</div>
							</div>
							<div className="admin-manager-section">
								<h4>Section</h4>
								<label className="admin-manager-select">
									<span>Post section</span>
									<select
										aria-label="Post section"
										value={activeManagedPost.sectionId ?? ""}
										disabled={actionPending === `${activeManagedPost.id}:section`}
										onChange={(event) =>
											void updatePostSection(
												activeManagedPost,
												event.currentTarget.value || null,
											)
										}
									>
										<option value="">No section</option>
										{sections.map((section) => (
											<option key={section.id} value={section.id}>
												{section.name}
											</option>
										))}
									</select>
								</label>
							</div>
							<div className="admin-manager-section">
								<h4>Album media</h4>
								<label className="admin-switch-row">
									<input
										type="checkbox"
										aria-label="Show this post's media in the album"
										checked={activeManagedPost.albumMediaEnabled === true}
										disabled={
											actionPending === `${activeManagedPost.id}:album-on` ||
											actionPending === `${activeManagedPost.id}:album-off`
										}
										onChange={(event) =>
											runAction(
												activeManagedPost,
												event.currentTarget.checked ? "album-on" : "album-off",
											)
										}
									/>
									<span className="admin-switch-track" aria-hidden="true" />
									<span className="admin-switch-copy">
										<span>Show this post's media in the album</span>
									</span>
								</label>
							</div>
							<div className="admin-manager-section danger">
								<h4>Danger zone</h4>
								<button
									type="button"
									className="danger-link"
									disabled={actionPending === `${activeManagedPost.id}:delete`}
									onClick={() => setDeleteDialogPost(activeManagedPost)}
								>
									Delete
								</button>
							</div>
					</div>
				</div>
			) : null}
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
			{commentsDialogPost ? (
				<div className="admin-modal-backdrop">
					<div
						className="admin-modal admin-comments-modal"
						role="dialog"
						aria-label="Post comments"
						aria-modal="true"
					>
						<div className="admin-comments-modal-heading">
							<div>
								<h3>Comments</h3>
								<p>{postTitle(commentsDialogPost)}</p>
							</div>
							<span className="admin-badge">
								{postComments.length} comments
							</span>
						</div>
						<label className="admin-comments-toggle">
							<input
								type="checkbox"
								checked={postCommentsEnabled}
								onChange={(event) =>
									setPostCommentsEnabled(event.currentTarget.checked)
								}
							/>
							Enable comments for this post
						</label>
						<div className="admin-modal-actions">
							<button
								type="button"
								className="admin-modal-secondary"
								disabled={postCommentsSaving}
								onClick={savePostCommentsSetting}
							>
								{postCommentsSaving ? "Saving..." : "Save setting"}
							</button>
						</div>
						{postCommentsError ? (
							<p className="admin-error">{postCommentsError}</p>
						) : null}
						{postCommentsLoading ? (
							<p className="admin-note">Loading comments...</p>
						) : postComments.length > 0 ? (
							<ol className="admin-comment-list">
								{postComments.map((comment) => (
									<li className="admin-comment-item" key={comment.id}>
										<header>
											<div>
												<strong>{comment.nickname || "Anonymous"}</strong>
												<time dateTime={comment.createdAt}>
													{formatCommentDate(comment.createdAt)}
												</time>
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
														disabled={postCommentsUpdating?.startsWith(
															`${comment.id}:`,
														)}
														onClick={() => approvePostComment(comment)}
													>
														Approve
													</button>
												) : null}
												<button
													type="button"
													className="danger-link"
													disabled={postCommentsDeleting === comment.id}
													onClick={() => deletePostComment(comment)}
												>
													{postCommentsDeleting === comment.id
														? "Deleting..."
														: "Delete"}
												</button>
											</div>
										</header>
										<p>{comment.body}</p>
										<label className="admin-comment-reply">
											Reply to {comment.nickname || "Anonymous"}
											<textarea
												value={postCommentReplies[comment.id] ?? ""}
												rows={3}
												maxLength={2000}
												onChange={(event) => {
													const nextReply = event.currentTarget.value;
													setPostCommentReplies((current) => ({
														...current,
														[comment.id]: nextReply,
													}));
												}}
											/>
										</label>
										<div className="admin-comment-reply-actions">
											<button
												type="button"
												disabled={postCommentsUpdating?.startsWith(
													`${comment.id}:`,
												)}
												onClick={() => savePostCommentReply(comment)}
											>
												Save reply
											</button>
											{comment.replyCreatedAt ? (
												<time dateTime={comment.replyCreatedAt}>
													Replied {formatCommentDate(comment.replyCreatedAt)}
												</time>
											) : null}
										</div>
									</li>
								))}
							</ol>
						) : (
							<p className="admin-note">No comments yet.</p>
						)}
						<div className="admin-modal-actions">
							<button
								type="button"
								className="admin-modal-secondary"
								onClick={() => {
									setCommentsDialogPost(null);
									setPostComments([]);
									setPostCommentReplies({});
									setPostCommentsError(null);
								}}
							>
								Close
							</button>
						</div>
					</div>
				</div>
			) : null}
			{sectionDeleteDialog ? (
				<div className="admin-modal-backdrop">
					<div
						className="admin-modal"
						role="dialog"
						aria-label="Delete section"
						aria-modal="true"
					>
						<h3>Delete section</h3>
						<p>
							{sectionDeleteDialog.name} has {sectionDeleteDialog.postCount ?? 0} posts.
						</p>
						<p>Those posts will move to No section.</p>
						<div className="admin-modal-actions">
							<button
								type="button"
								className="admin-modal-secondary"
								onClick={() => setSectionDeleteDialog(null)}
							>
								Cancel
							</button>
							<button
								type="button"
								className="danger"
								disabled={
									sectionActionPending ===
									`${sectionDeleteDialog.id}:delete`
								}
								onClick={() => void deletePostSection(sectionDeleteDialog, true)}
							>
								Delete section
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
