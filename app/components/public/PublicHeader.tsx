import { useEffect, useRef, useState } from "react";
import type { FocusEvent, FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { apiGet } from "../../lib/api-client";
import { SearchIcon } from "./SearchIcon";
import { ThemeModeButton } from "./ThemeModeButton";

type PublicPostSection = {
	id: string;
	name: string;
	slug: string;
	sortOrder: number;
};

type PublicPostSectionsResponse = {
	items: PublicPostSection[];
};

export function PublicHeader() {
	const navigate = useNavigate();
	const location = useLocation();
	const [searchParams] = useSearchParams();
	const [query, setQuery] = useState(searchParams.get("q")?.trim() ?? "");
	const [searchOpen, setSearchOpen] = useState(false);
	const [sections, setSections] = useState<PublicPostSection[]>([]);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const currentPath = location.pathname;

	useEffect(() => {
		setQuery(searchParams.get("q")?.trim() ?? "");
	}, [searchParams]);

	useEffect(() => {
		if (searchOpen) {
			searchInputRef.current?.focus();
		}
	}, [searchOpen]);

	useEffect(() => {
		let cancelled = false;

		apiGet<PublicPostSectionsResponse>("/api/post-sections")
			.then((response) => {
				if (cancelled) {
					return;
				}

				setSections(
					(response.items ?? [])
						.filter(
							(section) =>
								typeof section.name === "string" &&
								typeof section.slug === "string" &&
								section.name.trim() &&
								section.slug.trim(),
						)
						.sort((left, right) => left.sortOrder - right.sortOrder),
				);
			})
			.catch(() => {
				if (!cancelled) {
					setSections([]);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

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
			</div>
			<div className="public-header-spacer" aria-hidden="true" />
			<div className="public-header-actions">
				<Link
					className={`home-entry-button${currentPath === "/" ? " active" : ""}`}
					to="/"
				>
					Home
				</Link>
				{sections.map((section) => {
					const path = `/${section.slug}`;
					return (
						<Link
							className={`section-entry-button${
								currentPath === path ? " active" : ""
							}`}
							key={section.id}
							to={path}
						>
							{section.name}
						</Link>
					);
				})}
				<Link
					className={`album-entry-button${
						currentPath === "/album" ? " active" : ""
					}`}
					to="/album"
				>
					Album
				</Link>
				<Link
					className={`archive-entry-button${
						currentPath === "/archive" ? " active" : ""
					}`}
					to="/archive"
				>
					Archived
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
		</header>
	);
}
