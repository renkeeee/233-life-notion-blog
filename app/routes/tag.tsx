import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
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

export default function Tag() {
	const { tag } = useParams();
	const [state, setState] = useState<LoadState>({ status: "loading" });

	useEffect(() => {
		if (!tag) {
			setState({ status: "error", message: "Tag not found" });
			return;
		}

		let cancelled = false;

		apiGet<PostsResponse>(`/api/posts?tag=${encodeURIComponent(tag)}`)
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
							error instanceof Error ? error.message : "Unable to load tag",
					});
				}
			});

		return () => {
			cancelled = true;
		};
	}, [tag]);

	return (
		<main className="public-shell">
			<header className="public-header">
				<div>
					<Link className="back-link" to="/">
						All posts
					</Link>
					<p className="eyebrow">Tag</p>
					<h1>{tag}</h1>
				</div>
			</header>

			{state.status === "loading" ? <p className="state-note">Loading posts...</p> : null}
			{state.status === "error" ? (
				<p className="state-note state-error">{state.message}</p>
			) : null}
			{state.status === "success" && state.posts.length === 0 ? (
				<p className="state-note">No published posts use this tag.</p>
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
