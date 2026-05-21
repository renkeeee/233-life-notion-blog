import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { PublicHeader } from "../components/public/PublicHeader";
import { apiGet } from "../lib/api-client";

type AlbumMediaKind = "image" | "video" | "audio" | "pdf" | "file";

type AlbumMediaItem = {
	id: string;
	postId: string;
	postSlug: string;
	postTitle: string;
	category: string | null;
	tags: string[];
	kind: AlbumMediaKind;
	url: string;
	thumbnailUrl?: string;
	caption: string;
	publishedAt: string | null;
	updatedAt: string;
};

type AlbumResponse = {
	items: AlbumMediaItem[];
};

type LoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
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

function mediaDate(item: AlbumMediaItem): Date | null {
	const value = item.publishedAt ?? item.updatedAt;
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
	return item.caption || item.postTitle || mediaLabel(item.kind);
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
			<section className="media-preview-dialog" role="dialog" aria-label="Media preview" aria-modal="true">
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
					{item.kind === "image" ? <img src={item.url} alt={title} /> : null}
					{item.kind === "video" ? (
						<video src={item.url} controls autoPlay playsInline />
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
					<Link to={`/post/${item.postSlug}`}>{item.postTitle}</Link>
					<time dateTime={item.publishedAt ?? item.updatedAt}>
						{formatDate(item)}
					</time>
				</div>
			</section>
		</div>
	);
}

export default function Album() {
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const [previewItem, setPreviewItem] = useState<AlbumMediaItem | null>(null);

	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });

		apiGet<AlbumResponse>("/api/album")
			.then((response) => {
				if (!cancelled) {
					setState({ status: "success", items: response.items });
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setState({ status: "error", message: errorMessage(error) });
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const groups = useMemo(
		() => (state.status === "success" ? albumGroups(state.items) : []),
		[state],
	);

	return (
		<main className="public-shell">
			<PublicHeader />
			<section className="archive-page album-page">
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
				{state.status === "success" && state.items.length === 0 ? (
					<p className="state-note">No media has been synced yet.</p>
				) : null}
				{groups.map((year) => (
					<section className="archive-year album-year" key={year.year}>
						<h3>
							<span>{year.year}</span>
							<sup>{year.count}</sup>
						</h3>
						<div className="archive-months">
							{year.months.map((month) => (
								<section className="archive-month album-month" key={month.key}>
									<div className="archive-month-label">
										<span>{month.label}</span>
										<sup>{month.items.length}</sup>
									</div>
									<div className="album-grid">
										{month.items.map((item) => (
											<article className="album-media-card" key={item.id}>
												<div className="album-media-day">{formatDay(item)}</div>
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
													<Link to={`/post/${item.postSlug}`}>{item.postTitle}</Link>
												</div>
											</article>
										))}
									</div>
								</section>
							))}
						</div>
					</section>
				))}
			</section>
			{previewItem ? (
				<MediaPreview item={previewItem} onClose={() => setPreviewItem(null)} />
			) : null}
		</main>
	);
}
