import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router";
import { PostDetail, type PublicPostDetail } from "../components/public/PostDetail";
import { apiGet, apiPost } from "../lib/api-client";

type LockedPostDetail = {
	locked: true;
	slug: string;
	title: string;
};

type LoadState =
	| { status: "loading" }
	| { status: "error"; message: string }
	| {
			status: "locked";
			post: LockedPostDetail;
			password: string;
			message: string | null;
			submitting: boolean;
	  }
	| { status: "success"; post: PublicPostDetail };

type PostApiResponse = PublicPostDetail | LockedPostDetail;

function isLockedPost(response: PostApiResponse): response is LockedPostDetail {
	return "locked" in response && response.locked === true;
}

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

		apiGet<PostApiResponse>(`/api/posts/${encodeURIComponent(slug)}`)
			.then((post) => {
				if (!cancelled) {
					setState(
						isLockedPost(post)
							? {
									status: "locked",
									post,
									password: "",
									message: null,
									submitting: false,
								}
							: { status: "success", post },
					);
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

	async function unlockPost(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (state.status !== "locked") {
			return;
		}

		const password = state.password;
		if (!password) {
			setState({ ...state, message: "Password is required." });
			return;
		}

		setState({ ...state, submitting: true, message: null });
		try {
			const post = await apiPost<PublicPostDetail>(
				`/api/posts/${encodeURIComponent(state.post.slug)}/unlock`,
				{ password },
			);
			setState({ status: "success", post });
		} catch (error) {
			setState({
				...state,
				submitting: false,
				message: error instanceof Error ? error.message : "Unable to unlock post.",
			});
		}
	}

	return (
		<main className="public-shell narrow">
			{state.status === "loading" ? <PostDetailSkeleton /> : null}
			{state.status === "error" ? (
				<div className="state-panel">
					<p className="state-note state-error">{state.message}</p>
					<Link to="/">Return to posts</Link>
				</div>
			) : null}
			{state.status === "locked" ? (
				<article className="post-detail">
					<header className="post-detail-header">
						<Link className="back-link" to="/">
							All posts
						</Link>
						<p className="post-meta">Private post</p>
						<h1>{state.post.title}</h1>
					</header>
					<form className="post-lock-panel" onSubmit={unlockPost}>
						<label>
							Post password
							<input
								type="password"
								value={state.password}
								onChange={(event) =>
									setState({
										...state,
										password: event.currentTarget.value,
										message: null,
									})
								}
								autoComplete="current-password"
							/>
						</label>
						{state.message ? (
							<p className="state-note state-error">{state.message}</p>
						) : null}
						<button type="submit" disabled={state.submitting}>
							{state.submitting ? "Unlocking..." : "Unlock post"}
						</button>
					</form>
				</article>
			) : null}
			{state.status === "success" ? <PostDetail post={state.post} /> : null}
		</main>
	);
}
