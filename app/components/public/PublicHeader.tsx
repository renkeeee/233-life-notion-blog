import { useCallback, useEffect, useRef, useState } from "react";
import type { FocusEvent, FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { apiGet } from "../../lib/api-client";
import { SearchIcon } from "./SearchIcon";
import { ThemeModeButton } from "./ThemeModeButton";

export type CountSummary = {
	name: string;
	count: number;
};

type CountState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "success"; items: CountSummary[] };

type PublicHeaderProps = {
	categoriesState?: CountState;
	onLoadCategories?: () => void;
	onSelectCategory?: (category: string | null) => void;
	onSelectTag?: (tag: string) => void;
	selectedCategory?: string | null;
	selectedTag?: string | null;
};

type TagsResponse = {
	items: CountSummary[];
};

type CategoriesResponse = {
	items: CountSummary[];
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unable to load options";
}

export function PublicHeader({
	categoriesState,
	onLoadCategories,
	onSelectCategory,
	onSelectTag,
	selectedCategory = null,
	selectedTag = null,
}: PublicHeaderProps) {
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const [query, setQuery] = useState(searchParams.get("q")?.trim() ?? "");
	const [searchOpen, setSearchOpen] = useState(false);
	const [categoriesOpen, setCategoriesOpen] = useState(false);
	const [internalCategoriesState, setInternalCategoriesState] =
		useState<CountState>({ status: "idle" });
	const [tagsState, setTagsState] = useState<CountState>({ status: "idle" });
	const [tagPickerOpen, setTagPickerOpen] = useState(false);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const categoriesRequestRef = useRef(false);

	const effectiveCategoriesState = categoriesState ?? internalCategoriesState;
	const currentPath = location.pathname;

	useEffect(() => {
		setQuery(searchParams.get("q")?.trim() ?? "");
	}, [searchParams]);

	useEffect(() => {
		if (searchOpen) {
			searchInputRef.current?.focus();
		}
	}, [searchOpen]);

	const loadInternalCategories = useCallback(async () => {
		if (categoriesRequestRef.current) {
			return;
		}

		categoriesRequestRef.current = true;
		setInternalCategoriesState({ status: "loading" });
		try {
			const response = await apiGet<CategoriesResponse>("/api/categories");
			setInternalCategoriesState({
				status: "success",
				items: response.items,
			});
		} catch (error: unknown) {
			setInternalCategoriesState({
				status: "error",
				message: errorMessage(error),
			});
		} finally {
			categoriesRequestRef.current = false;
		}
	}, []);

	function loadCategories() {
		if (onLoadCategories) {
			onLoadCategories();
			return;
		}

		void loadInternalCategories();
	}

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
			if (next && effectiveCategoriesState.status === "idle") {
				loadCategories();
			}

			return next;
		});
	}

	function categoryDestination(category: string | null): string {
		return category ? `/?category=${encodeURIComponent(category)}` : "/";
	}

	function tagDestination(tag: string): string {
		return `/?tag=${encodeURIComponent(tag)}`;
	}

	function selectCategory(category: string | null) {
		if (onSelectCategory) {
			onSelectCategory(category);
			return;
		}

		navigate(categoryDestination(category));
	}

	function selectTag(tag: string) {
		if (onSelectTag) {
			onSelectTag(tag);
		} else {
			navigate(tagDestination(tag));
		}
		setTagPickerOpen(false);
	}

	function openTagPicker() {
		setTagPickerOpen(true);
		if (tagsState.status === "idle") {
			void loadTags();
		}
	}

	function submitSearch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = query.trim();
		if (trimmed) {
			navigate(`/search?q=${encodeURIComponent(trimmed)}`);
			return;
		}

		setSearchOpen(true);
	}

	function collapseSearchIfEmpty(event: FocusEvent<HTMLFormElement>) {
		if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
			return;
		}

		setSearchOpen(false);
	}

	return (
		<header className="public-header">
			<div className="public-header-brand-area">
				<div className="public-header-title-block">
					<p className="eyebrow">Life, written in quiet moments.</p>
					<Link className="site-title-link" to="/">
						<h1 className="site-title">233.life</h1>
					</Link>
				</div>
				<div className="public-header-filters">
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
								{effectiveCategoriesState.status === "error" ? (
									<button
										type="button"
										className="category-option"
										onClick={loadCategories}
									>
										Retry
									</button>
								) : null}
								{effectiveCategoriesState.status === "success"
									? effectiveCategoriesState.items.map((category) => (
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
					<button
						className="tag-entry-button"
						type="button"
						onClick={openTagPicker}
					>
						Tags
					</button>
				</div>
			</div>
			<div className="public-header-spacer" aria-hidden="true" />
			<div className="public-header-actions">
				<Link
					className={`home-entry-button${currentPath === "/" ? " active" : ""}`}
					to="/"
				>
					Home
				</Link>
				<Link
					className={`archive-entry-button${
						currentPath === "/archive" ? " active" : ""
					}`}
					to="/archive"
				>
					Archived
				</Link>
				<Link
					className={`album-entry-button${
						currentPath === "/album" ? " active" : ""
					}`}
					to="/album"
				>
					Album
				</Link>
				<form
					className={`search-form expandable capsule${searchOpen ? " expanded" : ""}`}
					onBlur={collapseSearchIfEmpty}
					onSubmit={submitSearch}
					role="search"
				>
					<div>
						<input
							id="public-search"
							ref={searchInputRef}
							aria-label="Search posts"
							value={query}
							onChange={(event) => setQuery(event.currentTarget.value)}
							placeholder="Keyword"
							tabIndex={searchOpen ? 0 : -1}
						/>
						<button
							type="submit"
							aria-expanded={searchOpen}
							aria-label="Search"
							onClick={() => setSearchOpen(true)}
						>
							<SearchIcon />
						</button>
					</div>
				</form>
				<ThemeModeButton />
			</div>
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
		</header>
	);
}
