import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { PostList, type PublicPostSummary } from "../components/public/PostList";
import { apiGet } from "../lib/api-client";

type SearchResponse = {
	items: PublicPostSummary[];
	total: number;
	q: string;
};

type LoadState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "success"; posts: PublicPostSummary[]; total: number };

export default function Search() {
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const q = searchParams.get("q")?.trim() ?? "";
	const [query, setQuery] = useState(q);
	const [state, setState] = useState<LoadState>(
		q ? { status: "loading" } : { status: "idle" },
	);

	useEffect(() => {
		setQuery(q);
		if (!q) {
			setState({ status: "idle" });
			return;
		}

		let cancelled = false;
		setState({ status: "loading" });

		apiGet<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`)
			.then((response) => {
				if (!cancelled) {
					setState({
						status: "success",
						posts: response.items,
						total: response.total,
					});
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setState({
						status: "error",
						message:
							error instanceof Error ? error.message : "Unable to search posts",
					});
				}
			});

		return () => {
			cancelled = true;
		};
	}, [q]);

	function submitSearch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmed = query.trim();
		navigate(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
	}

	return (
		<main className="public-shell">
			<header className="public-header">
				<div>
					<Link className="back-link" to="/">
						All posts
					</Link>
					<p className="eyebrow">Search</p>
					<h1>{q ? `Results for "${q}"` : "Search posts"}</h1>
				</div>
				<form className="search-form" onSubmit={submitSearch}>
					<label htmlFor="search-query">Keyword</label>
					<div>
						<input
							id="search-query"
							value={query}
							onChange={(event) => setQuery(event.currentTarget.value)}
							placeholder="Keyword"
						/>
						<button type="submit">Search</button>
					</div>
				</form>
			</header>

			{state.status === "idle" ? (
				<p className="state-note">Enter a keyword to search published posts.</p>
			) : null}
			{state.status === "loading" ? <p className="state-note">Searching...</p> : null}
			{state.status === "error" ? (
				<p className="state-note state-error">{state.message}</p>
			) : null}
			{state.status === "success" && state.posts.length === 0 ? (
				<p className="state-note">No posts matched this search.</p>
			) : null}
			{state.status === "success" && state.posts.length > 0 ? (
				<>
					<p className="result-count">{state.total} matches</p>
					<PostList posts={state.posts} />
				</>
			) : null}
		</main>
	);
}
