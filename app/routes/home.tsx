import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { PostList, type PublicPostSummary } from "../components/public/PostList";
import {
	PublicHeader,
	type CountSummary,
} from "../components/public/PublicHeader";
import { apiGet } from "../lib/api-client";

type PostsResponse = {
	items: PublicPostSummary[];
	total: number;
	page: number;
	limit: number;
	categories?: CountSummary[];
};

type CategoriesResponse = {
	items: CountSummary[];
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

type CategoriesState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "success"; items: CountSummary[] };

type LoadMode = "replace" | "append";

const homePageSize = 20;

function postsPath(
	page: number,
	tag: string | null,
	category: string | null,
): string {
	const params = new URLSearchParams({
		page: String(page),
		limit: String(homePageSize),
	});

	if (tag) {
		params.set("tag", tag);
	}

	if (category) {
		params.set("category", category);
	}

	if (page === 1) {
		params.set("include", "categories");
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
	const [searchParams] = useSearchParams();
	const initialCategory = searchParams.get("category")?.trim() || null;
	const initialTag = searchParams.get("tag")?.trim() || null;
	const [selectedCategory, setSelectedCategory] = useState<string | null>(
		initialCategory,
	);
	const [categoriesState, setCategoriesState] = useState<CategoriesState>({
		status: "idle",
	});
	const [selectedTag, setSelectedTag] = useState<string | null>(initialTag);
	const [state, setState] = useState<LoadState>({ status: "loading" });
	const loadMoreRef = useRef<HTMLDivElement | null>(null);
	const activeRequestRef = useRef(0);
	const fetchingRef = useRef(false);
	const categoriesRequestRef = useRef(false);

	useEffect(() => {
		setSelectedCategory(searchParams.get("category")?.trim() || null);
		setSelectedTag(searchParams.get("tag")?.trim() || null);
	}, [searchParams]);

	const loadPosts = useCallback(
		async (page: number, mode: LoadMode) => {
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
				const response = await apiGet<PostsResponse>(
					postsPath(page, selectedTag, selectedCategory),
				);

				if (activeRequestRef.current !== requestId) {
					return;
				}

				if (mode === "replace" && page === 1 && response.categories) {
					setCategoriesState({
						status: "success",
						items: response.categories,
					});
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
		},
		[selectedCategory, selectedTag],
	);

	useEffect(() => {
		void loadPosts(1, "replace");

		return () => {
			activeRequestRef.current += 1;
			fetchingRef.current = false;
		};
	}, [loadPosts]);

	const loadCategories = useCallback(async () => {
		if (categoriesRequestRef.current) {
			return;
		}

		categoriesRequestRef.current = true;
		setCategoriesState({ status: "loading" });
		try {
			const response = await apiGet<CategoriesResponse>("/api/categories");
			setCategoriesState({
				status: "success",
				items: response.items,
			});
		} catch (error: unknown) {
			setCategoriesState({
				status: "error",
				message: errorMessage(error),
			});
		} finally {
			categoriesRequestRef.current = false;
		}
	}, []);

	function selectCategory(category: string | null) {
		setSelectedCategory(category);
		const params = new URLSearchParams();
		if (category) {
			params.set("category", category);
		}
		if (selectedTag) {
			params.set("tag", selectedTag);
		}
		navigate(params.size ? `/?${params.toString()}` : "/", { replace: true });
	}

	function selectTag(tag: string) {
		setSelectedTag(tag);
		const params = new URLSearchParams();
		if (selectedCategory) {
			params.set("category", selectedCategory);
		}
		params.set("tag", tag);
		navigate(`/?${params.toString()}`, { replace: true });
	}

	function clearTagFilter() {
		setSelectedTag(null);
		const params = new URLSearchParams();
		if (selectedCategory) {
			params.set("category", selectedCategory);
		}
		navigate(params.size ? `/?${params.toString()}` : "/", { replace: true });
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

	return (
		<main className="public-shell">
			<PublicHeader
				categoriesState={categoriesState}
				onLoadCategories={() => void loadCategories()}
				onSelectCategory={selectCategory}
				onSelectTag={selectTag}
				selectedCategory={selectedCategory}
				selectedTag={selectedTag}
			/>

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
					{selectedCategory
						? "No posts match this category yet."
						: selectedTag
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
		</main>
	);
}
