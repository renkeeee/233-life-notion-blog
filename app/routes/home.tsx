import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { PostList, type PublicPostSummary } from "../components/public/PostList";
import { PublicHeader } from "../components/public/PublicHeader";
import { apiGet } from "../lib/api-client";

type CountSummary = {
	name: string;
	count: number;
};

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

type TagsResponse = {
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
	const [categoriesOpen, setCategoriesOpen] = useState(false);
	const [selectedTag, setSelectedTag] = useState<string | null>(initialTag);
	const [tagsState, setTagsState] = useState<CategoriesState>({ status: "idle" });
	const [tagPickerOpen, setTagPickerOpen] = useState(false);
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

	async function loadTags() {
		setTagsState({ status: "loading" });
		try {
			const response = await apiGet<TagsResponse>("/api/tags");
			setTagsState({ status: "success", items: response.items });
		} catch (error: unknown) {
			setTagsState({
				status: "error",
				message: errorMessage(error),
			});
		}
	}

	function toggleCategories() {
		setCategoriesOpen((current) => {
			const next = !current;
			if (next && categoriesState.status === "idle") {
				void loadCategories();
			}

			return next;
		});
	}

	function openTagPicker() {
		setTagPickerOpen(true);
		if (tagsState.status === "idle") {
			void loadTags();
		}
	}

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
		setTagPickerOpen(false);
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

	function filterControls() {
		return (
			<div className="home-filter-actions">
				<div className={`category-switcher${categoriesOpen ? " expanded" : ""}`}>
					{categoriesOpen ? (
						<div className="category-list" aria-label="Categories">
							<button
								type="button"
								aria-label="All categories"
								className={`category-option${
									selectedCategory === null ? " active" : ""
								}`}
								onClick={() => selectCategory(null)}
							>
								All
							</button>
							{categoriesState.status === "error" ? (
								<button
									type="button"
									className="category-option"
									onClick={() => void loadCategories()}
								>
									Retry
								</button>
							) : null}
							{categoriesState.status === "success"
								? categoriesState.items.map((category) => (
										<button
											type="button"
											aria-label={`${category.name} ${category.count}`}
											className={`category-option${
												selectedCategory === category.name ? " active" : ""
											}`}
											key={category.name}
											onClick={() => selectCategory(category.name)}
										>
											<span>{category.name}</span>
											<span>{category.count}</span>
										</button>
									))
								: null}
						</div>
					) : null}
					<button
						className="category-entry-button"
						type="button"
						aria-expanded={categoriesOpen}
						onClick={toggleCategories}
					>
						Categories
					</button>
				</div>
				<button className="tag-entry-button" type="button" onClick={openTagPicker}>
					Tags
				</button>
			</div>
		);
	}

	return (
		<main className="public-shell">
			<PublicHeader />

			{state.status === "loading" ? <PostListSkeleton /> : null}
			{state.status === "error" ? (
				<p className="state-note state-error">{state.message}</p>
			) : null}
			{state.status === "success" ? (
				<div className="home-content-toolbar">
					<p className="result-count">{state.total} posts</p>
					{filterControls()}
				</div>
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
					<PostList posts={state.posts} />
					<div className="load-more-panel" ref={loadMoreRef} aria-live="polite">
						{loadMoreContent()}
					</div>
				</>
			) : null}
			{tagPickerOpen ? (
				<div className="tag-dialog-backdrop">
					<section className="tag-dialog compact" role="dialog" aria-label="Tags">
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
						{tagsState.status === "success" && tagsState.items.length === 0 ? (
							<p className="state-note">No tags have been synced yet.</p>
						) : null}
						{tagsState.status === "success" && tagsState.items.length > 0 ? (
							<div className="tag-picker-list">
								{tagsState.items.map((tag) => (
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
