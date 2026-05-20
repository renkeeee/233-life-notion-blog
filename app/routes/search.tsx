import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { PostList, type PublicPostSummary } from "../components/public/PostList";
import { PublicHeader } from "../components/public/PublicHeader";
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
	const [searchParams] = useSearchParams();
	const q = searchParams.get("q")?.trim() ?? "";
	const [state, setState] = useState<LoadState>(
		q ? { status: "loading" } : { status: "idle" },
	);

	useEffect(() => {
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

	return (
		<main className="public-shell">
			<PublicHeader />
			<section className="public-page-heading">
				<p className="eyebrow">Search</p>
				<h2>{q ? `Results for "${q}"` : "Search posts"}</h2>
			</section>

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
