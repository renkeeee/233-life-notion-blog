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
	const [selectedIds, setSelectedIds] = useState<string[]>([]);
	const [pending, setPending] = useState(false);
	const [toast, setToast] = useState<string | null>(null);
	const [collectionTitleInput, setCollectionTitleInput] = useState("");
	const [uploadFile, setUploadFile] = useState<File | null>(null);
	const [uploadTitle, setUploadTitle] = useState("");

	const pageCount = useMemo(
		() => Math.max(1, Math.ceil(total / pageSize)),
		[total],
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
		<div className="admin-stack">
			<div className="admin-section-heading">
				<h2>Album</h2>
				<span className="admin-badge">Media library</span>
			</div>

			<form className="admin-form admin-post-filters" onSubmit={applyFilters}>
				<label>
					Keyword
					<input
						type="search"
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
					Featured
				</label>
				<button type="submit">Apply filters</button>
			</form>

			<div className="admin-album-tools">
				<form className="admin-inline-form" onSubmit={createCollection}>
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
				<form className="admin-inline-form" onSubmit={upload}>
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
			</div>

			<div className="admin-inline-actions">
				<button type="button" disabled={pending} onClick={() => batchAction("hide")}>
					Hide selected
				</button>
				<button type="button" disabled={pending} onClick={() => batchAction("restore")}>
					Restore selected
				</button>
				<button type="button" disabled={pending} onClick={() => batchAction("feature")}>
					Feature selected
				</button>
				<button type="button" disabled={pending} onClick={() => batchAction("delete")}>
					Delete selected
				</button>
			</div>

			<p className="admin-note">{status}</p>
			{toast ? <p className="admin-toast">{toast}</p> : null}
			{error ? <p className="admin-error">{error}</p> : null}

			<div className="admin-table-wrap">
				<table className="admin-table admin-album-table">
					<thead>
						<tr>
							<th>Select</th>
							<th>Preview</th>
							<th>Title</th>
							<th>Kind</th>
							<th>Collections</th>
							<th>Visibility</th>
							<th>Actions</th>
						</tr>
					</thead>
					<tbody>
						{items.map((item) => (
							<tr key={item.id}>
								<td>
									<input
										aria-label={`Select ${item.title}`}
										type="checkbox"
										checked={selectedIds.includes(item.id)}
										onChange={() => toggleSelection(item.id)}
									/>
								</td>
								<td>
									<div className="admin-album-thumb">{mediaThumb(item)}</div>
								</td>
								<td>
									<strong>{item.title || item.caption || "Untitled"}</strong>
									{item.post?.slug ? (
										<a href={`/post/${encodeURIComponent(item.post.slug)}`}>
											{item.post.title || item.post.slug}
										</a>
									) : null}
								</td>
								<td>{item.kind}</td>
								<td>
									{item.collectionIds.length
										? item.collectionIds
												.map((id) => collectionTitle(id, collections))
												.join(", ")
										: "-"}
								</td>
								<td>{item.visibility}</td>
								<td>
									<div className="admin-row-actions">
										<button type="button" onClick={() => openEditor(item)}>
											Edit
										</button>
										<button
											type="button"
											onClick={() =>
												itemAction(
													item,
													item.visibility === "hidden" ? "restore" : "hide",
												)
											}
										>
											{item.visibility === "hidden" ? "Restore" : "Hide"}
										</button>
										<button type="button" onClick={() => itemAction(item, "delete")}>
											Delete
										</button>
									</div>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<div className="admin-pagination">
				<button
					type="button"
					disabled={page <= 1}
					onClick={() => setPage((current) => Math.max(1, current - 1))}
				>
					Previous
				</button>
				<span>
					Page {page} / {pageCount}
				</span>
				<button
					type="button"
					disabled={page >= pageCount}
					onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
				>
					Next
				</button>
			</div>

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
								onClick={() => setEditingItem(null)}
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
