import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { PublicHeader } from "../components/public/PublicHeader";
import { apiGet } from "../lib/api-client";

type AlbumMediaKind = "image" | "video" | "audio" | "pdf" | "file";

type AlbumMediaItem = {
	id: string;
	title: string;
	description: string;
	postId: string | null;
	postSlug: string | null;
	postTitle: string | null;
	category: string | null;
	tags: string[];
	kind: AlbumMediaKind;
	url: string;
	thumbnailUrl?: string;
	largeUrl?: string;
	caption: string;
	takenAt: string | null;
	locationName: string;
	latitude: number | null;
	longitude: number | null;
	featured: boolean;
	collectionSlugs: string[];
	publishedAt: string | null;
	updatedAt: string;
};

type AlbumCollection = {
	id: string;
	slug: string;
	title: string;
	description: string;
	coverItemId: string | null;
	sortOrder: number;
};

type AlbumResponse = {
	items: AlbumMediaItem[];
	page: number;
	limit: number;
	hasMore: boolean;
	collections: AlbumCollection[];
};

type LoadState =
	| { status: "loading"; items: AlbumMediaItem[] }
	| { status: "error"; message: string; items: AlbumMediaItem[] }
	| { status: "success"; items: AlbumMediaItem[] };

type AlbumMonth = {
	key: string;
	label: string;
	items: AlbumMediaItem[];
};

type AlbumYear = {
	year: string;
	count: number;
	months: AlbumMonth[];
};

const albumPageSize = 30;

function mediaDate(item: AlbumMediaItem): Date | null {
	const value = item.takenAt ?? item.publishedAt ?? item.updatedAt;
	if (!value) {
		return null;
	}

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatDay(item: AlbumMediaItem): string {
	const date = mediaDate(item);
	if (!date) {
		return "Undated";
	}

	return new Intl.DateTimeFormat("en", {
		day: "numeric",
		timeZone: "UTC",
	}).format(date);
}

function formatDate(item: AlbumMediaItem): string {
	const date = mediaDate(item);
	if (!date) {
		return "Undated";
	}

	return new Intl.DateTimeFormat("en", {
		month: "long",
		day: "numeric",
		year: "numeric",
		timeZone: "UTC",
	}).format(date);
}

function albumGroups(items: AlbumMediaItem[]): AlbumYear[] {
	const years = new Map<string, Map<string, AlbumMonth>>();
	const counts = new Map<string, number>();

	for (const item of items) {
		const date = mediaDate(item);
		const year = date
			? new Intl.DateTimeFormat("en", {
					year: "numeric",
					timeZone: "UTC",
				}).format(date)
			: "Undated";
		const monthKey = date
			? `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
			: "undated";
		const monthLabel = date
			? new Intl.DateTimeFormat("en", {
					month: "long",
					timeZone: "UTC",
				}).format(date)
			: "Undated";
		const monthMap = years.get(year) ?? new Map<string, AlbumMonth>();
		const month = monthMap.get(monthKey) ?? {
			key: monthKey,
			label: monthLabel,
			items: [],
		};

		month.items.push(item);
		monthMap.set(monthKey, month);
		years.set(year, monthMap);
		counts.set(year, (counts.get(year) ?? 0) + 1);
	}

	return Array.from(years, ([year, months]) => ({
		year,
		count: counts.get(year) ?? 0,
		months: Array.from(months.values()),
	}));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unable to load album";
}

function mediaLabel(kind: AlbumMediaKind): string {
	return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function mediaTitle(item: AlbumMediaItem): string {
	return item.title || item.caption || item.postTitle || mediaLabel(item.kind);
}

function buildAlbumPath({
	page,
	collection,
	kind,
	featured,
}: {
	page: number;
	collection: string;
	kind: string;
	featured: boolean;
}): string {
	const params = new URLSearchParams();
	params.set("page", String(page));
	params.set("limit", String(albumPageSize));
	if (collection) {
		params.set("collection", collection);
	}
	if (kind) {
		params.set("kind", kind);
	}
	if (featured) {
		params.set("featured", "1");
	}

	return `/api/album?${params.toString()}`;
}

function MediaThumbnail({ item }: { item: AlbumMediaItem }) {
	const title = mediaTitle(item);

	if (item.kind === "image") {
		return (
			<img
				src={item.thumbnailUrl || item.url}
				alt={title}
				loading="lazy"
				decoding="async"
			/>
		);
	}

	if (item.kind === "video") {
		return <video src={item.url} muted playsInline preload="metadata" />;
	}

	return (
		<div className="album-media-placeholder">
			<span>{mediaLabel(item.kind)}</span>
		</div>
	);
}

function MediaPreview({
	item,
	onClose,
}: {
	item: AlbumMediaItem;
	onClose: () => void;
}) {
	const title = mediaTitle(item);

	useEffect(() => {
		function closeOnEscape(event: KeyboardEvent) {
			if (event.key === "Escape") {
				onClose();
			}
		}

		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [onClose]);

	return (
		<div
			className="media-preview-backdrop"
			onClick={(event) => {
				if (event.target === event.currentTarget) {
					onClose();
				}
			}}
		>
			<section
				className="media-preview-dialog"
				role="dialog"
				aria-label="Media preview"
				aria-modal="true"
			>
				<div className="media-preview-toolbar">
					<div>
						<p>{mediaLabel(item.kind)}</p>
						<h2>{title}</h2>
					</div>
					<button type="button" aria-label="Close preview" onClick={onClose}>
						Close
					</button>
				</div>
				<div className="media-preview-stage">
					{item.kind === "image" ? (
						<img src={item.largeUrl || item.url} alt={title} />
					) : null}
					{item.kind === "video" ? (
						<video src={item.largeUrl || item.url} controls autoPlay playsInline />
					) : null}
					{item.kind === "audio" ? <audio src={item.url} controls /> : null}
					{item.kind === "pdf" ? (
						<iframe src={item.url} title={title} loading="lazy" />
					) : null}
					{item.kind === "file" ? (
						<div className="media-preview-file">
							<a href={item.url} target="_blank" rel="noreferrer">
								Open file
							</a>
						</div>
					) : null}
				</div>
				<div className="media-preview-meta">
					{item.postSlug ? (
						<Link to={`/post/${item.postSlug}`}>
							{item.postTitle || item.postSlug}
						</Link>
					) : null}
					<time dateTime={item.takenAt ?? item.publishedAt ?? item.updatedAt}>
						{formatDate(item)}
					</time>
					{item.locationName ? <span>{item.locationName}</span> : null}
				</div>
			</section>
		</div>
	);
}

function AlbumMap({ items }: { items: AlbumMediaItem[] }) {
	const mappedItems = items.filter(
		(item) => item.latitude !== null && item.longitude !== null,
	);

	return (
		<section className="album-map-view" aria-label="Album map">
			{mappedItems.length === 0 ? (
				<p className="state-note">No mapped media in this view.</p>
			) : (
				mappedItems.map((item) => (
					<div className="album-map-pin" key={item.id}>
						<strong>{mediaTitle(item)}</strong>
						<span>{item.locationName || `${item.latitude}, ${item.longitude}`}</span>
					</div>
				))
			)}
		</section>
	);
}

export default function Album() {
	const [state, setState] = useState<LoadState>({
		status: "loading",
		items: [],
	});
	const [previewItem, setPreviewItem] = useState<AlbumMediaItem | null>(null);
	const [collections, setCollections] = useState<AlbumCollection[]>([]);
	const [selectedCollection, setSelectedCollection] = useState("");
	const [selectedKind, setSelectedKind] = useState("");
	const [featuredOnly, setFeaturedOnly] = useState(false);
	const [view, setView] = useState<"grid" | "map">("grid");
	const [page, setPage] = useState(1);
	const [hasMore, setHasMore] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading", items: [] });
		setPage(1);
		setHasMore(false);

		apiGet<AlbumResponse>(
			buildAlbumPath({
				page: 1,
				collection: selectedCollection,
				kind: selectedKind,
				featured: featuredOnly,
			}),
		)
			.then((response) => {
				if (!cancelled) {
					setState({ status: "success", items: response.items });
					setCollections(response.collections);
					setPage(response.page);
					setHasMore(response.hasMore);
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setState({
						status: "error",
						message: errorMessage(error),
						items: [],
					});
				}
			});

		return () => {
			cancelled = true;
		};
	}, [selectedCollection, selectedKind, featuredOnly]);

	async function loadMore() {
		if (!hasMore || loadingMore) {
			return;
		}

		const nextPage = page + 1;
		setLoadingMore(true);
		try {
			const response = await apiGet<AlbumResponse>(
				buildAlbumPath({
					page: nextPage,
					collection: selectedCollection,
					kind: selectedKind,
					featured: featuredOnly,
				}),
			);
			setState((current) => ({
				status: "success",
				items: [...current.items, ...response.items],
			}));
			setCollections((current) =>
				response.collections.length ? response.collections : current,
			);
			setPage(response.page);
			setHasMore(response.hasMore);
		} catch (error) {
			setState((current) => ({
				status: "error",
				message: errorMessage(error),
				items: current.items,
			}));
		} finally {
			setLoadingMore(false);
		}
	}

	const items = state.items;
	const groups = useMemo(() => albumGroups(items), [items]);

	return (
		<main className="public-shell">
			<PublicHeader />
			<section className="archive-page album-page">
				<div className="album-filter-bar">
					<div className="album-collection-switcher">
						<button
							type="button"
							className={selectedCollection === "" ? "active" : ""}
							onClick={() => setSelectedCollection("")}
						>
							All
						</button>
						{collections.map((collection) => (
							<button
								type="button"
								key={collection.slug}
								className={
									selectedCollection === collection.slug ? "active" : ""
								}
								onClick={() => setSelectedCollection(collection.slug)}
							>
								{collection.title}
							</button>
						))}
					</div>
					<div className="album-filter-controls">
						<select
							aria-label="Album kind"
							value={selectedKind}
							onChange={(event) => setSelectedKind(event.currentTarget.value)}
						>
							<option value="">All media</option>
							<option value="image">Images</option>
							<option value="video">Videos</option>
							<option value="audio">Audio</option>
							<option value="pdf">PDF</option>
							<option value="file">Files</option>
						</select>
						<button
							type="button"
							className={featuredOnly ? "active" : ""}
							onClick={() => setFeaturedOnly((current) => !current)}
						>
							Featured
						</button>
						<button
							type="button"
							className={view === "grid" ? "active" : ""}
							onClick={() => setView("grid")}
						>
							Grid
						</button>
						<button
							type="button"
							className={view === "map" ? "active" : ""}
							onClick={() => setView("map")}
						>
							Map
						</button>
					</div>
				</div>

				{state.status === "loading" ? (
					<div className="archive-skeleton" aria-label="Loading album" role="status">
						<div className="skeleton-line skeleton-title-line" />
						<div className="skeleton-line skeleton-copy-line wide" />
						<div className="skeleton-line skeleton-copy-line medium" />
					</div>
				) : null}
				{state.status === "error" ? (
					<p className="state-note state-error">{state.message}</p>
				) : null}
				{state.status === "success" && items.length === 0 ? (
					<p className="state-note">No media has been synced yet.</p>
				) : null}

				{view === "map" ? <AlbumMap items={items} /> : null}

				{view === "grid"
					? groups.map((year) => (
							<section className="archive-year album-year" key={year.year}>
								<h3>
									<span>{year.year}</span>
									<sup>{year.count}</sup>
								</h3>
								<div className="archive-months">
									{year.months.map((month) => (
										<section
											className="archive-month album-month"
											key={month.key}
										>
											<div className="archive-month-label">
												<span>{month.label}</span>
												<sup>{month.items.length}</sup>
											</div>
											<div className="album-grid">
												{month.items.map((item) => (
													<article className="album-media-card" key={item.id}>
														<div className="album-media-day">
															{formatDay(item)}
														</div>
														<button
															type="button"
															className="album-media-preview-trigger"
															aria-label={`Preview ${mediaTitle(item)}`}
															onClick={() => setPreviewItem(item)}
														>
															<MediaThumbnail item={item} />
														</button>
														<div className="album-media-copy">
															<span>{mediaLabel(item.kind)}</span>
															<strong>{mediaTitle(item)}</strong>
															{item.postSlug ? (
																<Link to={`/post/${item.postSlug}`}>
																	{item.postTitle || item.postSlug}
																</Link>
															) : null}
														</div>
													</article>
												))}
											</div>
										</section>
									))}
								</div>
							</section>
						))
					: null}

				{hasMore ? (
					<div className="album-load-more">
						<button type="button" disabled={loadingMore} onClick={loadMore}>
							{loadingMore ? "Loading..." : "Load more"}
						</button>
					</div>
				) : null}
			</section>
			{previewItem ? (
				<MediaPreview item={previewItem} onClose={() => setPreviewItem(null)} />
			) : null}
		</main>
	);
}
