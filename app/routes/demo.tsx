import { useMemo, useRef, useState } from "react";
import type { FocusEvent, FormEvent } from "react";
import { FiSearch } from "react-icons/fi";
import { PostList, type PublicPostSummary } from "../components/public/PostList";

type CountSummary = {
	name: string;
	count: number;
};

const demoPosts: PublicPostSummary[] = [
	{
		id: "demo-1",
		slug: "demo-slower-morning",
		title: "The shape of a slower morning",
		excerpt:
			"Tea cooling beside an open window, a page half-read, and the small decision to let the day arrive without hurry.",
		coverUrl:
			"https://images.unsplash.com/photo-1499728603263-13726abce5fd?auto=format&fit=crop&w=900&q=80",
		category: "Essays",
		tags: ["Quiet", "Morning", "Home"],
		publishedAt: "2026-05-12T08:30:00.000Z",
		updatedAt: "2026-05-12T08:30:00.000Z",
	},
	{
		id: "demo-2",
		slug: "demo-train-window",
		title: "Notes from a train window",
		excerpt:
			"Fields move like paragraphs outside the glass. Every station leaves behind a sentence I almost remember.",
		coverUrl:
			"https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
		category: "Travel",
		tags: ["Travel", "Notes"],
		publishedAt: "2026-04-28T14:20:00.000Z",
		updatedAt: "2026-04-28T14:20:00.000Z",
	},
	{
		id: "demo-3",
		slug: "demo-desk-light",
		title: "Desk light at 11:43",
		excerpt:
			"A small circle of lamplight can make the rest of the room feel less like darkness and more like patience.",
		coverUrl:
			"https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=80",
		category: "Notes",
		tags: ["Work", "Night"],
		publishedAt: "2026-04-16T23:43:00.000Z",
		updatedAt: "2026-04-16T23:43:00.000Z",
	},
	{
		id: "demo-4",
		slug: "demo-rain-in-april",
		title: "Rain in April",
		excerpt:
			"The city becomes softer under rain. Corners blur, umbrellas bloom, and errands learn a slower rhythm.",
		coverUrl:
			"https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=900&q=80",
		category: "Essays",
		tags: ["City", "Weather", "Quiet"],
		publishedAt: "2026-04-03T10:15:00.000Z",
		updatedAt: "2026-04-03T10:15:00.000Z",
	},
	{
		id: "demo-5",
		slug: "demo-pocket-list",
		title: "A pocket list for ordinary days",
		excerpt:
			"Buy pears. Call home. Walk one block farther than usual. Keep one corner of the afternoon unclaimed.",
		coverUrl: null,
		category: "Lists",
		tags: ["Daily", "Home"],
		publishedAt: "2026-03-21T09:00:00.000Z",
		updatedAt: "2026-03-21T09:00:00.000Z",
	},
	{
		id: "demo-6",
		slug: "demo-coffee-shop",
		title: "The corner table",
		excerpt:
			"Every neighborhood has a table where time sits down first. Mine is beside a fern and a scratched brass lamp.",
		coverUrl:
			"https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80",
		category: "Places",
		tags: ["City", "Coffee"],
		publishedAt: "2026-03-05T16:10:00.000Z",
		updatedAt: "2026-03-05T16:10:00.000Z",
	},
	{
		id: "demo-7",
		slug: "demo-shelf",
		title: "Things left on the shelf",
		excerpt:
			"Receipts, train tickets, a stone from the coast. Not keepsakes exactly, more like quiet proof of having passed through.",
		coverUrl:
			"https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=900&q=80",
		category: "Notes",
		tags: ["Memory", "Home"],
		publishedAt: "2026-02-18T18:25:00.000Z",
		updatedAt: "2026-02-18T18:25:00.000Z",
	},
];

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
		() => countBy(demoPosts.map((post) => post.category).filter(Boolean) as string[]),
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
					<PostList posts={posts} postHref={() => "/demo"} />
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
