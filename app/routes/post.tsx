import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { PostDetail, type PublicPostDetail } from "../components/public/PostDetail";
import { apiGet } from "../lib/api-client";

type LoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "success"; post: PublicPostDetail };

function PostDetailSkeleton() {
	return (
		<article
			className="post-detail-skeleton"
			aria-busy="true"
			aria-label="Loading post"
			role="status"
		>
			<header className="post-detail-header">
				<div className="skeleton-line skeleton-back-line" />
				<div className="skeleton-line skeleton-meta-line" />
				<div className="skeleton-line skeleton-detail-title-line" />
				<div className="skeleton-line skeleton-detail-title-short-line" />
			</header>
			<div className="markdown-skeleton">
				<div className="skeleton-line skeleton-copy-line" />
				<div className="skeleton-line skeleton-copy-line wide" />
				<div className="skeleton-line skeleton-copy-line medium" />
				<div className="skeleton-line skeleton-copy-line" />
				<div className="skeleton-line skeleton-copy-line short" />
			</div>
		</article>
	);
}

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
			{state.status === "loading" ? <PostDetailSkeleton /> : null}
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
