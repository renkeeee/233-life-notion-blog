import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router";
import { PostList, type PublicPostSummary } from "../components/public/PostList";
import { apiGet } from "../lib/api-client";

type PostsResponse = {
	items: PublicPostSummary[];
	total: number;
	page: number;
	limit: number;
};

type TagSummary = {
	name: string;
	count: number;
};

type TagsResponse = {
	items: TagSummary[];
};

type LoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| {
			status: "success";
			posts: PublicPostSummary[];
			total: number;
			page: number;
			limit: number;
			loadingMore: boolean;
			loadMoreError: string | null;
	  };

type TagsState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "success"; tags: TagSummary[] };

type LoadMode = "replace" | "append";

const homePageSize = 20;

function postsPath(page: number, tag: string | null): string {
	const params = new URLSearchParams({
		page: String(page),
		limit: String(homePageSize),
	});

	if (tag) {
		params.set("tag", tag);
	}

	return `/api/posts?${params.toString()}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unable to load posts";
}

function mergePosts(
	currentPosts: PublicPostSummary[],
	nextPosts: PublicPostSummary[],
): PublicPostSummary[] {
	const seenIds = new Set(currentPosts.map((post) => post.id));
	const uniqueNextPosts = nextPosts.filter((post) => !seenIds.has(post.id));

	return [...currentPosts, ...uniqueNextPosts];
}

function PostListSkeleton({
	count = 3,
	compact = false,
	label = "Loading posts",
}: {
	count?: number;
	compact?: boolean;
	label?: string;
}) {
	return (
		<div
			className={`post-list-skeleton${compact ? " compact" : ""}`}
			aria-busy="true"
			aria-label={label}
			role="status"
		>
			{Array.from({ length: count }, (_, index) => (
				<article className="post-skeleton-item" key={index} aria-hidden="true">
					<div className="skeleton-block skeleton-cover-block" />
					<div className="post-skeleton-body">
						<div className="skeleton-line skeleton-meta-line" />
						<div className="skeleton-line skeleton-title-line" />
						<div className="skeleton-line skeleton-short-line" />
					</div>
				</article>
			))}
		</div>
	);
}

export default function Home() {
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [tagPickerOpen, setTagPickerOpen] = useState(false);
	const [tagsState, setTagsState] = useState<TagsState>({ status: "idle" });
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const activeRequestRef = useRef(0);
	const fetchingRef = useRef(false);

	const loadPosts = useCallback(async (page: number, mode: LoadMode) => {
		if (fetchingRef.current && mode === "append") {
			return;
		}

		fetchingRef.current = true;
		const requestId = activeRequestRef.current + 1;
		activeRequestRef.current = requestId;

		if (mode === "replace") {
			setState({ status: "loading" });
		} else {
			setState((current) =>
				current.status === "success"
					? { ...current, loadingMore: true, loadMoreError: null }
					: current,
			);
		}

		try {
			const response = await apiGet<PostsResponse>(postsPath(page, selectedTag));

			if (activeRequestRef.current !== requestId) {
				return;
			}

			setState((current) => {
				if (mode === "append" && current.status === "success") {
					return {
						...current,
						posts: mergePosts(current.posts, response.items),
						total: response.total,
						page: response.page,
						limit: response.limit,
						loadingMore: false,
						loadMoreError: null,
					};
				}

				return {
					status: "success",
					posts: response.items,
					total: response.total,
					page: response.page,
					limit: response.limit,
					loadingMore: false,
					loadMoreError: null,
				};
			});
		} catch (error: unknown) {
			if (activeRequestRef.current !== requestId) {
				return;
			}

			if (mode === "append") {
				setState((current) =>
					current.status === "success"
						? {
								...current,
								loadingMore: false,
								loadMoreError: errorMessage(error),
						  }
						: current,
				);
			} else {
				setState({
					status: "error",
					message: errorMessage(error),
				});
			}
		} finally {
			if (activeRequestRef.current === requestId) {
				fetchingRef.current = false;
			}
		}
	}, [selectedTag]);

	useEffect(() => {
		void loadPosts(1, "replace");

		return () => {
			activeRequestRef.current += 1;
			fetchingRef.current = false;
		};
	}, [loadPosts]);

	async function loadTags() {
		setTagsState({ status: "loading" });
		try {
			const response = await apiGet<TagsResponse>("/api/tags");
			setTagsState({ status: "success", tags: response.items });
		} catch (error: unknown) {
			setTagsState({
				status: "error",
				message: errorMessage(error),
			});
		}
	}

	function openTagPicker() {
		setTagPickerOpen(true);
		if (tagsState.status === "idle") {
			void loadTags();
		}
	}

	function selectTag(tag: string) {
		setSelectedTag(tag);
		setTagPickerOpen(false);
	}

	function clearTagFilter() {
		setSelectedTag(null);
	}

	const canLoadMore =
		state.status === "success" &&
		state.posts.length < state.total &&
		!state.loadingMore;
	const canAutoLoadMore =
		canLoadMore && state.status === "success" && !state.loadMoreError;

	const loadNextPage = useCallback(() => {
		if (!canLoadMore || state.status !== "success") {
			return;
		}

		void loadPosts(state.page + 1, "append");
	}, [canLoadMore, loadPosts, state]);

	useEffect(() => {
		if (!canAutoLoadMore || typeof IntersectionObserver === "undefined") {
			return;
		}

		const target = loadMoreRef.current;
		if (!target) {
			return;
		}

		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					loadNextPage();
				}
			},
			{ rootMargin: "240px 0px" },
		);

		observer.observe(target);
		return () => observer.disconnect();
	}, [canAutoLoadMore, loadNextPage]);

	function loadMoreContent() {
		if (state.status !== "success" || state.posts.length >= state.total) {
			return null;
		}

		if (state.loadingMore) {
			return <PostListSkeleton count={2} compact label="Loading more posts" />;
		}

		if (state.loadMoreError) {
			return (
				<div className="load-more-error">
					<p>{state.loadMoreError}</p>
					<button type="button" onClick={loadNextPage}>
						Retry
					</button>
				</div>
			);
		}

		return (
			<button className="load-more-button" type="button" onClick={loadNextPage}>
				Load more
			</button>
		);
	}

	function submitSearch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = query.trim();
		if (trimmed) {
			navigate(`/search?q=${encodeURIComponent(trimmed)}`);
		}
	}

	return (
		<main className="public-shell">
			<header className="public-header">
				<div>
					<p className="eyebrow">Life, written in quiet moments.</p>
					<h1 className="site-title">233.life</h1>
				</div>
				<div className="public-header-actions">
					<button className="tag-entry-button" type="button" onClick={openTagPicker}>
						Tags
					</button>
				</div>
				<form className="search-form" onSubmit={submitSearch}>
					<label htmlFor="home-search">Search posts</label>
					<div>
						<input
							id="home-search"
							value={query}
							onChange={(event) => setQuery(event.currentTarget.value)}
							placeholder="Keyword"
						/>
						<button type="submit">Search</button>
					</div>
				</form>
			</header>

			{state.status === "loading" ? <PostListSkeleton /> : null}
			{state.status === "error" ? (
				<p className="state-note state-error">{state.message}</p>
			) : null}
			{state.status === "success" && selectedTag ? (
				<p className="tag-filter-note">
					Filtered by {selectedTag}
					<button type="button" onClick={clearTagFilter}>
						Clear
					</button>
				</p>
			) : null}
			{state.status === "success" && state.posts.length === 0 ? (
				<p className="state-note">
					{selectedTag
						? "No posts match this tag yet."
						: "No posts have been published yet."}
				</p>
			) : null}
			{state.status === "success" && state.posts.length > 0 ? (
				<>
					<p className="result-count">{state.total} posts</p>
					<PostList posts={state.posts} />
					<div className="load-more-panel" ref={loadMoreRef} aria-live="polite">
						{loadMoreContent()}
					</div>
				</>
			) : null}
			{tagPickerOpen ? (
				<div className="tag-dialog-backdrop">
					<section className="tag-dialog" role="dialog" aria-label="Tags">
						<div className="tag-dialog-heading">
							<h2>Tags</h2>
							<button type="button" onClick={() => setTagPickerOpen(false)}>
								Close
							</button>
						</div>
						{tagsState.status === "loading" ? (
							<p className="state-note">Loading tags...</p>
						) : null}
						{tagsState.status === "error" ? (
							<div className="state-panel">
								<p className="state-note state-error">{tagsState.message}</p>
								<button type="button" onClick={() => void loadTags()}>
									Retry
								</button>
							</div>
						) : null}
						{tagsState.status === "success" && tagsState.tags.length === 0 ? (
							<p className="state-note">No tags have been synced yet.</p>
						) : null}
						{tagsState.status === "success" && tagsState.tags.length > 0 ? (
							<div className="tag-picker-list">
								{tagsState.tags.map((tag) => (
									<button
										type="button"
										aria-label={`${tag.name} ${tag.count}`}
										className={selectedTag === tag.name ? "active" : ""}
										key={tag.name}
										onClick={() => selectTag(tag.name)}
									>
										<span>{tag.name}</span>
										<span>{tag.count}</span>
									</button>
								))}
							</div>
						) : null}
					</section>
				</div>
			) : null}
		</main>
	);
}
