import { useEffect, useState } from "react";
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
	| { status: "success"; posts: PublicPostSummary[]; total: number };

export default function Home() {
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [state, setState] = useState<LoadState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;

		apiGet<PostsResponse>("/api/posts")
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
							error instanceof Error ? error.message : "Unable to load posts",
					});
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
				</>
			) : null}
		</main>
	);
}
