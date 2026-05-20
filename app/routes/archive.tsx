import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { PublicPostSummary } from "../components/public/PostList";
import { PublicHeader } from "../components/public/PublicHeader";
import { apiGet } from "../lib/api-client";

type ArchiveResponse = {
	items: PublicPostSummary[];
};

type LoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "success"; posts: PublicPostSummary[] };

type ArchiveMonth = {
	key: string;
	label: string;
	posts: PublicPostSummary[];
};

type ArchiveYear = {
	year: string;
	count: number;
	months: ArchiveMonth[];
};

function postDate(post: PublicPostSummary): Date | null {
	const value = post.publishedAt ?? post.updatedAt;
	if (!value) {
		return null;
	}

	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function formatDay(post: PublicPostSummary): string {
	const date = postDate(post);
	if (!date) {
		return "Undated";
	}

	return new Intl.DateTimeFormat("en", {
		day: "numeric",
		timeZone: "UTC",
	}).format(date);
}

function formatDate(post: PublicPostSummary): string {
	const date = postDate(post);
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

function archiveGroups(posts: PublicPostSummary[]): ArchiveYear[] {
	const years = new Map<string, Map<string, ArchiveMonth>>();
	const counts = new Map<string, number>();

	for (const post of posts) {
		const date = postDate(post);
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
		const monthMap = years.get(year) ?? new Map<string, ArchiveMonth>();
		const month = monthMap.get(monthKey) ?? {
			key: monthKey,
			label: monthLabel,
			posts: [],
		};

		month.posts.push(post);
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
	return error instanceof Error ? error.message : "Unable to load archive";
}

export default function Archive() {
	const [state, setState] = useState<LoadState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });

		apiGet<ArchiveResponse>("/api/archive")
			.then((response) => {
				if (!cancelled) {
					setState({ status: "success", posts: response.items });
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
		() => (state.status === "success" ? archiveGroups(state.posts) : []),
		[state],
	);

	return (
		<main className="public-shell">
			<PublicHeader />
			<section className="archive-page">
				<header className="archive-heading">
					<h2>Archive</h2>
				</header>

				{state.status === "loading" ? (
					<div className="archive-skeleton" aria-label="Loading archive" role="status">
						<div className="skeleton-line skeleton-title-line" />
						<div className="skeleton-line skeleton-copy-line wide" />
						<div className="skeleton-line skeleton-copy-line medium" />
					</div>
				) : null}
				{state.status === "error" ? (
					<p className="state-note state-error">{state.message}</p>
				) : null}
				{state.status === "success" && state.posts.length === 0 ? (
					<p className="state-note">No archived posts yet.</p>
				) : null}
				{groups.map((year) => (
					<section className="archive-year" key={year.year}>
						<h3>
							<span>{year.year}</span>
							<sup>{year.count}</sup>
						</h3>
						<div className="archive-months">
							{year.months.map((month) => (
								<section className="archive-month" key={month.key}>
									<div className="archive-month-label">
										<span>{month.label}</span>
										<sup>{month.posts.length}</sup>
									</div>
									<div className="archive-items">
										{month.posts.map((post) => (
											<article className="archive-item" key={post.id}>
												<div className="archive-day">{formatDay(post)}</div>
												<div className="archive-item-main">
													<h4>
														<Link to={`/post/${post.slug}`}>{post.title}</Link>
													</h4>
													<div className="archive-item-meta">
														<time dateTime={post.publishedAt ?? post.updatedAt}>
															{formatDate(post)}
														</time>
														{post.category ? <span>{post.category}</span> : null}
														{post.tags.map((tag) => (
															<span key={tag}>{tag}</span>
														))}
													</div>
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
		</main>
	);
}
