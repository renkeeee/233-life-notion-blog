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

type LoadMode = "replace" | "append";

const homePageSize = 20;

function postsPath(page: number): string {
	const params = new URLSearchParams({
		page: String(page),
		limit: String(homePageSize),
	});

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

export default function Home() {
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const activeRequestRef = useRef(0);
	const fetchingRef = useRef(false);

	const loadPosts = useCallback(async (page: number, mode: LoadMode) => {
		if (fetchingRef.current) {
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
			const response = await apiGet<PostsResponse>(postsPath(page));

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
	}, []);

	useEffect(() => {
		void loadPosts(1, "replace");

		return () => {
			activeRequestRef.current += 1;
			fetchingRef.current = false;
		};
	}, [loadPosts]);

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
			return <p className="load-more-status">Loading more posts...</p>;
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
					<h1>233.life</h1>
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

			{state.status === "loading" ? <p className="state-note">Loading posts...</p> : null}
			{state.status === "error" ? (
				<p className="state-note state-error">{state.message}</p>
			) : null}
			{state.status === "success" && state.posts.length === 0 ? (
				<p className="state-note">No posts have been published yet.</p>
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
		</main>
	);
}
