import { useMemo, useRef, useState } from "react";
import type { FocusEvent, FormEvent } from "react";
import { FiSearch } from "react-icons/fi";
import { PostList, type PublicPostSummary } from "../components/public/PostList";
import { demoPosts } from "../lib/demo-posts";

type CountSummary = {
	name: string;
	count: number;
};

function countBy(values: string[]): CountSummary[] {
	const counts = new Map<string, number>();

	for (const value of values) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}

	return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}

function matchesQuery(post: PublicPostSummary, query: string): boolean {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return true;
	}

	return [post.title, post.excerpt, post.category, ...post.tags]
		.filter(Boolean)
		.some((value) => value!.toLowerCase().includes(normalizedQuery));
}

export default function DemoHome() {
	const [query, setQuery] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
	const [categoriesOpen, setCategoriesOpen] = useState(false);
	const [selectedTag, setSelectedTag] = useState<string | null>(null);
	const [tagPickerOpen, setTagPickerOpen] = useState(false);
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	const categories = useMemo(
		() => countBy(demoPosts.flatMap((post) => post.category ? [post.category] : [])),
		[],
	);
	const tags = useMemo(
		() => countBy(demoPosts.flatMap((post) => post.tags)),
		[],
	);
	const posts = useMemo(
		() =>
			demoPosts.filter(
				(post) =>
					(selectedCategory === null || post.category === selectedCategory) &&
					(selectedTag === null || post.tags.includes(selectedTag)) &&
					matchesQuery(post, query),
			),
		[selectedCategory, selectedTag, query],
	);

	function submitSearch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSearchOpen(true);
		searchInputRef.current?.focus();
	}

	function collapseSearch(event: FocusEvent<HTMLFormElement>) {
		if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
			return;
		}

		setSearchOpen(false);
	}

	return (
		<main className="public-shell">
			<header className="public-header">
				<div>
					<p className="eyebrow">Life, written in quiet moments.</p>
					<h1 className="site-title">233.life</h1>
				</div>
				<div className="public-header-actions">
					<div
						className={`category-switcher${categoriesOpen ? " expanded" : ""}`}
					>
						{categoriesOpen ? (
							<div className="category-list" aria-label="Categories">
								<button
									type="button"
									aria-label="All categories"
									className={`category-option${
										selectedCategory === null ? " active" : ""
									}`}
									onClick={() => setSelectedCategory(null)}
								>
									All
								</button>
								{categories.map((category) => (
									<button
										type="button"
										aria-label={`${category.name} ${category.count}`}
										className={`category-option${
											selectedCategory === category.name ? " active" : ""
										}`}
										key={category.name}
										onClick={() => setSelectedCategory(category.name)}
									>
										<span>{category.name}</span>
										<span>{category.count}</span>
									</button>
								))}
							</div>
						) : null}
						<button
							className="category-entry-button"
							type="button"
							aria-expanded={categoriesOpen}
							onClick={() => setCategoriesOpen((current) => !current)}
						>
							Categories
						</button>
					</div>
					<button
						className="tag-entry-button"
						type="button"
						onClick={() => setTagPickerOpen(true)}
					>
						Tags
					</button>
					<form
						className={`search-form expandable capsule${searchOpen ? " expanded" : ""}`}
						onBlur={collapseSearch}
						onSubmit={submitSearch}
						role="search"
					>
						<div>
							<input
								id="demo-search"
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
								<FiSearch aria-hidden="true" focusable="false" />
							</button>
						</div>
					</form>
				</div>
			</header>

			{selectedTag ? (
				<p className="tag-filter-note">
					Filtered by {selectedTag}
					<button type="button" onClick={() => setSelectedTag(null)}>
						Clear
					</button>
				</p>
			) : null}
			{posts.length === 0 ? (
				<p className="state-note">No demo posts match this view.</p>
			) : (
				<>
					<p className="result-count">{posts.length} posts</p>
					<PostList posts={posts} postHref={(post) => `/demo/post/${post.slug}`} />
				</>
			)}

			{tagPickerOpen ? (
				<div className="tag-dialog-backdrop">
					<section className="tag-dialog compact" role="dialog" aria-label="Tags">
						<div className="tag-dialog-heading">
							<h2>Tags</h2>
							<button type="button" onClick={() => setTagPickerOpen(false)}>
								Close
							</button>
						</div>
						<div className="tag-picker-list">
							{tags.map((tag) => (
								<button
									type="button"
									aria-label={`${tag.name} ${tag.count}`}
									className={selectedTag === tag.name ? "active" : ""}
									key={tag.name}
									onClick={() => {
										setSelectedTag(tag.name);
										setTagPickerOpen(false);
									}}
								>
									<span>{tag.name}</span>
									<span>{tag.count}</span>
								</button>
							))}
						</div>
					</section>
				</div>
			) : null}
		</main>
	);
}
