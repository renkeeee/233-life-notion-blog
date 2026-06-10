import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { apiGet, apiPost, apiPut } from "../../lib/api-client";

type AlbumKind = "image" | "video" | "audio" | "pdf" | "file";
type AlbumVisibility = "visible" | "hidden";

type AlbumCollection = {
	id: string;
	slug: string;
	title: string;
	description: string;
	visibility: AlbumVisibility;
	sortOrder: number;
};

type AlbumItem = {
	id: string;
	sourceType?: "post_media" | "manual";
	kind: AlbumKind;
	url: string;
	thumbnailUrl?: string | null;
	largeUrl?: string | null;
	title: string;
	description: string;
	caption: string;
	takenAt: string | null;
	locationName: string;
	latitude: number | null;
	longitude: number | null;
	visibility: AlbumVisibility;
	featured: boolean;
	sortOrder?: number;
	collectionIds: string[];
	post: { id: string; slug: string | null; title: string | null } | null;
	updatedAt?: string | null;
};

type AlbumResponse = {
	items: AlbumItem[];
	total: number;
	page: number;
	limit: number;
	collections: AlbumCollection[];
};

type AlbumSettingsResponse = {
	postMediaEnabled: boolean;
};

type AlbumItemForm = {
	title: string;
	description: string;
	caption: string;
	takenAt: string;
	locationName: string;
	latitude: string;
	longitude: string;
	featured: boolean;
	collectionIds: string[];
};

const pageSize = 30;
const kindOptions: Array<{ value: "" | AlbumKind; label: string }> = [
	{ value: "", label: "All kinds" },
	{ value: "image", label: "Images" },
	{ value: "video", label: "Videos" },
	{ value: "audio", label: "Audio" },
	{ value: "pdf", label: "PDF" },
	{ value: "file", label: "Files" },
];

function buildAlbumPath({
	page,
	q,
	kind,
	visibility,
	collection,
	featured,
}: {
	page: number;
	q: string;
	kind: string;
	visibility: string;
	collection: string;
	featured: boolean;
}): string {
	const params = new URLSearchParams();
	params.set("page", String(page));
	params.set("limit", String(pageSize));
	if (q.trim()) {
		params.set("q", q.trim());
	}
	if (kind) {
		params.set("kind", kind);
	}
	if (visibility) {
		params.set("visibility", visibility);
	}
	if (collection) {
		params.set("collection", collection);
	}
	if (featured) {
		params.set("featured", "1");
	}

	return `/api/admin/album?${params.toString()}`;
}

function rangeLabel(page: number, limit: number, total: number): string {
	if (total === 0) {
		return "No album items";
	}

	const start = (page - 1) * limit + 1;
	const end = Math.min(page * limit, total);
	return `${start}-${end} of ${total} album items`;
}

function itemForm(item: AlbumItem): AlbumItemForm {
	return {
		title: item.title ?? "",
		description: item.description ?? "",
		caption: item.caption ?? "",
		takenAt: item.takenAt ?? "",
		locationName: item.locationName ?? "",
		latitude: item.latitude === null ? "" : String(item.latitude),
		longitude: item.longitude === null ? "" : String(item.longitude),
		featured: item.featured === true,
		collectionIds: item.collectionIds ?? [],
	};
}

function numberOrNull(value: string): number | null {
	const trimmed = value.trim();
	return trimmed ? Number(trimmed) : null;
}

function collectionTitle(
	collectionId: string,
	collections: AlbumCollection[],
): string {
	return (
		collections.find((collection) => collection.id === collectionId)?.title ??
		collectionId
	);
}

function itemTitle(item: AlbumItem): string {
	return item.title?.trim() || item.caption?.trim() || "Untitled media";
}

function itemSourceLabel(item: AlbumItem): string {
	return item.sourceType === "manual" ? "manual upload" : "post media";
}

function itemStateTags(item: AlbumItem): string[] {
	const tags: string[] = [item.kind, item.visibility];
	if (item.featured) {
		tags.push("featured");
	}
	if (item.post) {
		tags.push("linked");
	}

	return tags;
}

function formatItemDate(value?: string | null): string {
	if (!value) {
		return "-";
	}

	return new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(value));
}

function fileToBase64(file: File): Promise<string> {
	return file.arrayBuffer().then((buffer) => {
		const bytes = new Uint8Array(buffer);
		let binary = "";
		for (const byte of bytes) {
			binary += String.fromCharCode(byte);
		}

		return btoa(binary);
	});
}

function mediaThumb(item: AlbumItem) {
	if (item.kind === "image") {
		return (
			<img
				alt={item.title || item.caption || "Album item"}
				src={item.thumbnailUrl || item.url}
			/>
		);
	}

	return <span>{item.kind}</span>;
}

export function AlbumPanel({ csrfToken }: { csrfToken: string }) {
	const [items, setItems] = useState<AlbumItem[]>([]);
	const [collections, setCollections] = useState<AlbumCollection[]>([]);
	const [status, setStatus] = useState("Loading album...");
	const [error, setError] = useState<string | null>(null);
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [keyword, setKeyword] = useState("");
	const [appliedKeyword, setAppliedKeyword] = useState("");
	const [kind, setKind] = useState("");
	const [appliedKind, setAppliedKind] = useState("");
	const [visibility, setVisibility] = useState("");
	const [appliedVisibility, setAppliedVisibility] = useState("");
	const [collection, setCollection] = useState("");
	const [appliedCollection, setAppliedCollection] = useState("");
	const [featured, setFeatured] = useState(false);
	const [appliedFeatured, setAppliedFeatured] = useState(false);
	const [editingItem, setEditingItem] = useState<AlbumItem | null>(null);
	const [form, setForm] = useState<AlbumItemForm | null>(null);
	const [managedItem, setManagedItem] = useState<AlbumItem | null>(null);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [pending, setPending] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [collectionTitleInput, setCollectionTitleInput] = useState("");
	const [uploadFile, setUploadFile] = useState<File | null>(null);
	const [uploadTitle, setUploadTitle] = useState("");
	const [postMediaEnabled, setPostMediaEnabled] = useState(true);
	const [settingsStatus, setSettingsStatus] =
		useState("Loading album settings...");
	const [settingsPending, setSettingsPending] = useState(false);

	const pageCount = useMemo(
		() => Math.max(1, Math.ceil(total / pageSize)),
		[total],
	);
	const activeManagedItem = managedItem
		? (items.find((item) => item.id === managedItem.id) ?? managedItem)
		: null;
	const featuredCount = useMemo(
		() => items.filter((item) => item.featured).length,
		[items],
	);

	function loadAlbum(nextPage = page) {
		const path = buildAlbumPath({
			page: nextPage,
			q: appliedKeyword,
			kind: appliedKind,
			visibility: appliedVisibility,
			collection: appliedCollection,
			featured: appliedFeatured,
		});

		setStatus("Loading album...");
		setError(null);
		apiGet<AlbumResponse>(path)
			.then((response) => {
				setItems(response.items);
				setCollections(response.collections);
				setTotal(response.total);
				setPage(response.page);
				setSelectedIds([]);
				setManagedItem((current) =>
					current
						? (response.items.find((item) => item.id === current.id) ?? current)
						: null,
				);
				setStatus(rangeLabel(response.page, response.limit, response.total));
			})
			.catch((loadError: unknown) => {
				setItems([]);
				setTotal(0);
				setError(
					loadError instanceof Error
						? loadError.message
						: "Album could not be loaded.",
				);
				setStatus("Album could not be loaded.");
			});
	}

	useEffect(() => {
		loadAlbum(page);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		page,
		appliedKeyword,
		appliedKind,
		appliedVisibility,
		appliedCollection,
		appliedFeatured,
	]);

	useEffect(() => {
		let cancelled = false;

		apiGet<AlbumSettingsResponse>("/api/admin/album/settings")
			.then((response) => {
				if (cancelled) {
					return;
				}

				setPostMediaEnabled(response.postMediaEnabled);
				setSettingsStatus("Album settings loaded.");
			})
			.catch((loadError: unknown) => {
				if (!cancelled) {
					setSettingsStatus(
						loadError instanceof Error
							? loadError.message
							: "Album settings could not be loaded.",
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (!toast) {
			return;
		}

		const timeoutId = window.setTimeout(() => setToast(null), 3000);
		return () => window.clearTimeout(timeoutId);
	}, [toast]);

	function applyFilters(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setAppliedKeyword(keyword);
		setAppliedKind(kind);
		setAppliedVisibility(visibility);
		setAppliedCollection(collection);
		setAppliedFeatured(featured);
		setPage(1);
	}

	async function saveAlbumSettings(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSettingsPending(true);
		setSettingsStatus("Saving album settings...");
		try {
			const response = await apiPut<AlbumSettingsResponse>(
				"/api/admin/album/settings",
				{ postMediaEnabled },
				csrfToken,
			);
			setPostMediaEnabled(response.postMediaEnabled);
			setSettingsStatus("Album settings saved.");
			setToast("Album settings saved.");
		} catch (saveError) {
			setSettingsStatus(
				saveError instanceof Error
					? saveError.message
					: "Album settings could not be saved.",
			);
		} finally {
			setSettingsPending(false);
		}
	}

	function toggleSelection(itemId: string) {
		setSelectedIds((current) =>
			current.includes(itemId)
				? current.filter((id) => id !== itemId)
				: [...current, itemId],
		);
	}

	function openEditor(item: AlbumItem) {
		setEditingItem(item);
		setForm(itemForm(item));
	}

	function closeEditor() {
		setEditingItem(null);
		setForm(null);
	}

	function setFormValue<K extends keyof AlbumItemForm>(
		key: K,
		value: AlbumItemForm[K],
	) {
		setForm((current) => (current ? { ...current, [key]: value } : current));
	}

	async function saveItem(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!editingItem || !form) {
			return;
		}

		setPending(true);
		setError(null);
		try {
			await apiPut(
				`/api/admin/album/items/${encodeURIComponent(editingItem.id)}`,
				{
					title: form.title,
					description: form.description,
					caption: form.caption,
					takenAt: form.takenAt || null,
					locationName: form.locationName,
					latitude: numberOrNull(form.latitude),
					longitude: numberOrNull(form.longitude),
					featured: form.featured,
					collectionIds: form.collectionIds,
				},
				csrfToken,
			);
			setEditingItem(null);
			setForm(null);
			setToast("Album item saved.");
			loadAlbum(page);
		} catch (saveError) {
			setError(
				saveError instanceof Error
					? saveError.message
					: "Album item could not be saved.",
			);
		} finally {
			setPending(false);
		}
	}

	async function itemAction(item: AlbumItem, action: "hide" | "restore" | "delete") {
		setPending(true);
		setError(null);
		try {
			await apiPost(
				`/api/admin/album/items/${encodeURIComponent(item.id)}/${action}`,
				{},
				csrfToken,
			);
			setToast(`Album item ${action === "restore" ? "restored" : `${action}d`}.`);
			if (action === "delete") {
				setManagedItem(null);
			}
			loadAlbum(page);
		} catch (actionError) {
			setError(
				actionError instanceof Error
					? actionError.message
					: "Album action failed.",
			);
		} finally {
			setPending(false);
		}
	}

	async function batchAction(action: "hide" | "restore" | "delete" | "feature" | "unfeature") {
		if (selectedIds.length === 0) {
			setToast("Select album items first.");
			return;
		}

		setPending(true);
		setError(null);
		try {
			await apiPost(
				"/api/admin/album/batch",
				{ itemIds: selectedIds, action },
				csrfToken,
			);
			setToast("Batch action applied.");
			loadAlbum(page);
		} catch (actionError) {
			setError(
				actionError instanceof Error
					? actionError.message
					: "Batch action failed.",
			);
		} finally {
			setPending(false);
		}
	}

	async function createCollection(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!collectionTitleInput.trim()) {
			return;
		}

		setPending(true);
		setError(null);
		try {
			await apiPost(
				"/api/admin/album/collections",
				{ title: collectionTitleInput.trim() },
				csrfToken,
			);
			setCollectionTitleInput("");
			setToast("Collection created.");
			loadAlbum(page);
		} catch (collectionError) {
			setError(
				collectionError instanceof Error
					? collectionError.message
					: "Collection could not be created.",
			);
		} finally {
			setPending(false);
		}
	}

	async function upload(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!uploadFile) {
			setToast("Choose a file first.");
			return;
		}

		setPending(true);
		setError(null);
		try {
			await apiPost(
				"/api/admin/album/upload",
				{
					fileName: uploadFile.name,
					contentType: uploadFile.type,
					contentBase64: await fileToBase64(uploadFile),
					title: uploadTitle.trim() || uploadFile.name,
				},
				csrfToken,
			);
			setUploadFile(null);
			setUploadTitle("");
			setToast("Upload added to album.");
			loadAlbum(page);
		} catch (uploadError) {
			setError(
				uploadError instanceof Error ? uploadError.message : "Upload failed.",
			);
		} finally {
			setPending(false);
		}
	}

	function onFileChange(event: ChangeEvent<HTMLInputElement>) {
		setUploadFile(event.currentTarget.files?.[0] ?? null);
	}

	return (
		<div className="admin-stack admin-album-page">
			<section className="admin-post-workbench admin-album-workbench">
				<div>
					<p className="admin-eyebrow">Media operations</p>
					<h2>Album</h2>
					<p>
						Review synced post media, upload standalone files, organize
						collections, and control what appears in the public album.
					</p>
				</div>
				<div className="admin-post-workbench-actions">
					<div className="admin-post-summary-grid" aria-label="Album summary">
						<span>
							<strong>{total}</strong>
							items
						</span>
						<span>
							<strong>{collections.length}</strong>
							collections
						</span>
						<span>
							<strong>{featuredCount}</strong>
							featured
						</span>
					</div>
					<div className="admin-post-summary-grid compact" aria-label="Selection summary">
						<span>
							<strong>{selectedIds.length}</strong>
							selected
						</span>
						<span>
							<strong>{items.length}</strong>
							in view
						</span>
						<span>
							<strong>{page}</strong>
							page
						</span>
					</div>
				</div>
			</section>

			<section className="admin-album-command-grid">
				<form className="admin-album-command-card" onSubmit={upload}>
					<div>
						<p className="admin-eyebrow">Add media</p>
						<h3>Upload media</h3>
						<p>Manual uploads become standalone album items.</p>
					</div>
					<label>
						Upload file
						<input type="file" onChange={onFileChange} />
					</label>
					<label>
						Upload title
						<input
							value={uploadTitle}
							onChange={(event) => setUploadTitle(event.currentTarget.value)}
						/>
					</label>
					<button type="submit" disabled={pending}>
						Upload
					</button>
				</form>
				<form className="admin-album-command-card" onSubmit={createCollection}>
					<div>
						<p className="admin-eyebrow">Organize</p>
						<h3>New collection</h3>
						<p>Create a grouping, then assign media from the inspector.</p>
					</div>
					<label>
						Collection title
						<input
							value={collectionTitleInput}
							onChange={(event) =>
								setCollectionTitleInput(event.currentTarget.value)
							}
						/>
					</label>
					<button type="submit" disabled={pending}>
						Create collection
					</button>
				</form>
				<form className="admin-album-command-card" onSubmit={saveAlbumSettings}>
					<div>
						<p className="admin-eyebrow">Settings</p>
						<h3>Article media</h3>
						<p>Allow eligible post media to appear in the public album.</p>
					</div>
					<label className="admin-checkbox-row">
						<input
							type="checkbox"
							checked={postMediaEnabled}
							onChange={(event) =>
								setPostMediaEnabled(event.currentTarget.checked)
							}
						/>
						<span>Show media from posts</span>
					</label>
					<button type="submit" disabled={settingsPending}>
						{settingsPending ? "Saving..." : "Save settings"}
					</button>
					<p className="admin-note">{settingsStatus}</p>
				</form>
			</section>

			<div className="admin-album-workspace">
				<section className="admin-module admin-album-library">
					<form className="admin-form admin-album-filters" onSubmit={applyFilters}>
						<label>
							Keyword
							<input
								type="search"
								placeholder="Search title or caption"
								value={keyword}
								onChange={(event) => setKeyword(event.currentTarget.value)}
							/>
						</label>
						<label>
							Kind
							<select
								value={kind}
								onChange={(event) => setKind(event.currentTarget.value)}
							>
								{kindOptions.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
						<label>
							Visibility
							<select
								value={visibility}
								onChange={(event) => setVisibility(event.currentTarget.value)}
							>
								<option value="">All visibility</option>
								<option value="visible">Visible</option>
								<option value="hidden">Hidden</option>
							</select>
						</label>
						<label>
							Collection
							<select
								value={collection}
								onChange={(event) => setCollection(event.currentTarget.value)}
							>
								<option value="">All collections</option>
								{collections.map((item) => (
									<option key={item.id} value={item.id}>
										{item.title}
									</option>
								))}
							</select>
						</label>
						<label className="admin-checkbox-row">
							<input
								type="checkbox"
								checked={featured}
								onChange={(event) => setFeatured(event.currentTarget.checked)}
							/>
							<span>Featured only</span>
						</label>
						<button type="submit">Apply filters</button>
					</form>

					<div className="admin-post-list-status">
						<p className="admin-note">{status}</p>
						{error ? <p className="admin-error">{error}</p> : null}
						{toast ? (
							<div className="admin-toast" role="status">
								{toast}
							</div>
						) : null}
					</div>

					{selectedIds.length > 0 ? (
						<div className="admin-album-batch-bar">
							<strong>{selectedIds.length} selected</strong>
							<div className="admin-manager-actions">
								<button
									type="button"
									disabled={pending}
									onClick={() => batchAction("hide")}
								>
									Hide
								</button>
								<button
									type="button"
									disabled={pending}
									onClick={() => batchAction("restore")}
								>
									Restore
								</button>
								<button
									type="button"
									disabled={pending}
									onClick={() => batchAction("feature")}
								>
									Feature
								</button>
								<button
									type="button"
									disabled={pending}
									onClick={() => batchAction("unfeature")}
								>
									Unfeature
								</button>
								<button
									type="button"
									className="danger-link"
									disabled={pending}
									onClick={() => batchAction("delete")}
								>
									Delete
								</button>
							</div>
						</div>
					) : null}

					{items.length > 0 ? (
						<div className="admin-album-list" aria-label="Album media items">
							{items.map((item) => {
								const title = itemTitle(item);
								const isManaged = activeManagedItem?.id === item.id;

								return (
									<article
										className={`admin-album-card ${
											isManaged ? "selected" : ""
										}`.trim()}
										key={item.id}
									>
										<label className="admin-album-card-select">
											<input
												aria-label={`Select ${title}`}
												type="checkbox"
												checked={selectedIds.includes(item.id)}
												onChange={() => toggleSelection(item.id)}
											/>
										</label>
										<div className="admin-album-thumb">{mediaThumb(item)}</div>
										<div className="admin-album-card-body">
											<div>
												<h3>{title}</h3>
												<p>
													{itemSourceLabel(item)}
													{item.post?.slug ? (
														<>
															{" "}
															from{" "}
															<a href={`/post/${encodeURIComponent(item.post.slug)}`}>
																{item.post.title || item.post.slug}
															</a>
														</>
													) : null}
												</p>
											</div>
											<div className="admin-state-tags">
												{itemStateTags(item).map((tag) => (
													<span key={tag}>{tag}</span>
												))}
											</div>
											<div className="admin-album-card-meta">
												<span>{formatItemDate(item.takenAt ?? item.updatedAt)}</span>
												<span>
													{item.collectionIds.length
														? item.collectionIds
																.map((id) => collectionTitle(id, collections))
																.join(", ")
														: "No collection"}
												</span>
												{item.locationName ? <span>{item.locationName}</span> : null}
											</div>
										</div>
										<button
											type="button"
											className="admin-secondary-button"
											aria-pressed={isManaged}
											onClick={() => setManagedItem(item)}
										>
											Manage
										</button>
									</article>
								);
							})}
						</div>
					) : (
						<div className="admin-empty-state">
							<h3>No media in this view</h3>
							<p>Adjust filters, upload media, or sync posts with media assets.</p>
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
							onClick={() =>
								setPage((current) => Math.min(pageCount, current + 1))
							}
						>
							Next
						</button>
					</div>
				</section>

			</div>
			{activeManagedItem ? (
				<div className="admin-modal-backdrop">
					<div
						className="admin-modal admin-management-modal admin-album-inspector"
						role="dialog"
						aria-label="Album item management"
						aria-modal="true"
					>
							<div className="admin-post-manager-heading">
								<div>
									<p className="admin-eyebrow">Inspect media</p>
									<h3>{itemTitle(activeManagedItem)}</h3>
								</div>
								<button
									type="button"
									className="admin-action-icon"
									aria-label="Close album item management"
									onClick={() => setManagedItem(null)}
								>
									Close
								</button>
							</div>
							<div className="admin-album-inspector-preview">
								{mediaThumb(activeManagedItem)}
							</div>
							<div className="admin-state-tags">
								{itemStateTags(activeManagedItem).map((tag) => (
									<span key={tag}>{tag}</span>
								))}
							</div>
							<div className="admin-post-manager-meta">
								<span>{itemSourceLabel(activeManagedItem)}</span>
								<span>
									Taken {formatItemDate(activeManagedItem.takenAt)}
								</span>
								<span>
									Updated {formatItemDate(activeManagedItem.updatedAt)}
								</span>
								{activeManagedItem.locationName ? (
									<span>{activeManagedItem.locationName}</span>
								) : null}
								{activeManagedItem.post?.slug ? (
									<a
										href={`/post/${encodeURIComponent(
											activeManagedItem.post.slug,
										)}`}
									>
										{activeManagedItem.post.title ?? activeManagedItem.post.slug}
									</a>
								) : null}
							</div>
							<div className="admin-manager-section">
								<h4>Collections</h4>
								<div className="admin-album-collection-tags">
									{activeManagedItem.collectionIds.length > 0 ? (
										activeManagedItem.collectionIds.map((id) => (
											<span key={id}>{collectionTitle(id, collections)}</span>
										))
									) : (
										<span>No collection</span>
									)}
								</div>
							</div>
							<div className="admin-manager-section">
								<h4>Item actions</h4>
								<div className="admin-manager-actions">
									<button type="button" onClick={() => openEditor(activeManagedItem)}>
										Edit details
									</button>
									<button
										type="button"
										disabled={pending}
										onClick={() =>
											itemAction(
												activeManagedItem,
												activeManagedItem.visibility === "hidden"
													? "restore"
													: "hide",
											)
										}
									>
										{activeManagedItem.visibility === "hidden"
											? "Restore"
											: "Hide"}
									</button>
								</div>
							</div>
							<div className="admin-manager-section danger">
								<h4>Danger zone</h4>
								<button
									type="button"
									className="danger-link"
									disabled={pending}
									onClick={() => itemAction(activeManagedItem, "delete")}
								>
									Delete
								</button>
							</div>
					</div>
				</div>
			) : null}

			{editingItem && form ? (
				<div className="admin-modal-backdrop">
					<form
						className="admin-modal admin-album-modal"
						aria-label="Edit album item"
						role="dialog"
						onSubmit={saveItem}
					>
						<div className="admin-section-heading compact">
							<h3>Edit album item</h3>
								<button
									type="button"
									className="admin-secondary-button"
									onClick={closeEditor}
								>
									Close
								</button>
						</div>
						<label>
							Title
							<input
								value={form.title}
								onChange={(event) =>
									setFormValue("title", event.currentTarget.value)
								}
							/>
						</label>
						<label>
							Description
							<textarea
								value={form.description}
								onChange={(event) =>
									setFormValue("description", event.currentTarget.value)
								}
							/>
						</label>
						<label>
							Caption
							<input
								value={form.caption}
								onChange={(event) =>
									setFormValue("caption", event.currentTarget.value)
								}
							/>
						</label>
						<label>
							Taken at
							<input
								value={form.takenAt}
								onChange={(event) =>
									setFormValue("takenAt", event.currentTarget.value)
								}
							/>
						</label>
						<label>
							Location
							<input
								value={form.locationName}
								onChange={(event) =>
									setFormValue("locationName", event.currentTarget.value)
								}
							/>
						</label>
						<label>
							Latitude
							<input
								value={form.latitude}
								onChange={(event) =>
									setFormValue("latitude", event.currentTarget.value)
								}
							/>
						</label>
						<label>
							Longitude
							<input
								value={form.longitude}
								onChange={(event) =>
									setFormValue("longitude", event.currentTarget.value)
								}
							/>
						</label>
						<label className="admin-checkbox-row">
							<input
								type="checkbox"
								checked={form.featured}
								onChange={(event) =>
									setFormValue("featured", event.currentTarget.checked)
								}
							/>
							Featured
						</label>
						<fieldset className="admin-fieldset">
							<legend>Collections</legend>
							{collections.map((item) => (
								<label className="admin-checkbox-row" key={item.id}>
									<input
										type="checkbox"
										checked={form.collectionIds.includes(item.id)}
										onChange={(event) => {
											const checked = event.currentTarget.checked;
											setFormValue(
												"collectionIds",
												checked
													? [...form.collectionIds, item.id]
													: form.collectionIds.filter((id) => id !== item.id),
											);
										}}
									/>
									{item.title}
								</label>
							))}
						</fieldset>
						<button type="submit" disabled={pending}>
							Save item
						</button>
					</form>
				</div>
			) : null}
		</div>
	);
}
