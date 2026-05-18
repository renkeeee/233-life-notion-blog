import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { PostDetail, type PublicPostDetail } from "../components/public/PostDetail";
import { apiGet } from "../lib/api-client";

type LoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "success"; post: PublicPostDetail };

export default function Post() {
	const { slug } = useParams();
	const [state, setState] = useState<LoadState>({ status: "loading" });

	useEffect(() => {
		if (!slug) {
			setState({ status: "error", message: "Post not found" });
			return;
		}

		let cancelled = false;

		apiGet<PublicPostDetail>(`/api/posts/${encodeURIComponent(slug)}`)
			.then((post) => {
				if (!cancelled) {
					setState({ status: "success", post });
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setState({
						status: "error",
						message:
							error instanceof Error ? error.message : "Unable to load post",
					});
				}
			});

		return () => {
			cancelled = true;
		};
	}, [slug]);

	return (
		<main className="public-shell narrow">
			{state.status === "loading" ? <p className="state-note">Loading post...</p> : null}
			{state.status === "error" ? (
				<div className="state-panel">
					<p className="state-note state-error">{state.message}</p>
					<Link to="/">Return to posts</Link>
				</div>
			) : null}
			{state.status === "success" ? <PostDetail post={state.post} /> : null}
		</main>
	);
}
