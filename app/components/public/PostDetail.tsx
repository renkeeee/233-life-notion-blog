import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { apiPost } from "../../lib/api-client";
import { Markdown } from "../../lib/markdown";
import { TurnstileWidget } from "./TurnstileWidget";
import { useTurnstileAccess } from "./AccessGate";
import type { PublicPostSummary } from "./PostList";

export type PublicPostComment = {
	id: string;
	nickname: string;
	body: string;
	createdAt: string;
};

export type PublicPostDetail = PublicPostSummary & {
	markdown: string;
	commentsEnabled?: boolean;
	comments?: PublicPostComment[];
};

function formatDate(value: string | null): string {
	if (!value) {
		return "Undated";
	}

	return new Intl.DateTimeFormat("en", {
		month: "long",
		day: "numeric",
		year: "numeric",
	}).format(new Date(value));
}

function formatCommentDate(value: string): string {
	return new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

function PostComments({ post }: { post: PublicPostDetail }) {
	const access = useTurnstileAccess();
	const [comments, setComments] = useState(post.comments ?? []);
	const [nickname, setNickname] = useState("");
	const [body, setBody] = useState("");
	const [turnstileToken, setTurnstileToken] = useState("");
	const [resetSignal, setResetSignal] = useState(0);
	const [submitting, setSubmitting] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const commentsEnabled = post.commentsEnabled === true;
	const shouldRender = commentsEnabled || comments.length > 0;
	const onTurnstileToken = useCallback((token: string) => {
		setTurnstileToken(token);
	}, []);

	if (!shouldRender) {
		return null;
	}

	async function submitComment(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!commentsEnabled || submitting) {
			return;
		}

		if (!body.trim()) {
			setMessage("Comment content is required.");
			return;
		}

		if (access.enabled && !turnstileToken) {
			setMessage("Please complete the Turnstile check.");
			return;
		}

		setSubmitting(true);
		setMessage(null);
		try {
			const response = await apiPost<{ comment: PublicPostComment }>(
				`/api/posts/${encodeURIComponent(post.slug)}/comments`,
				{
					nickname,
					body,
					turnstileToken,
				},
			);
			setComments((current) => [...current, response.comment]);
			setNickname("");
			setBody("");
			setTurnstileToken("");
			setResetSignal((current) => current + 1);
			setMessage("Comment posted.");
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : "Comment could not be posted.",
			);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<section className="post-comments" aria-labelledby="post-comments-title">
			<hr className="post-comments-divider" />
			<div className="post-comments-heading">
				<h2 id="post-comments-title">Comments</h2>
				<span>{comments.length}</span>
			</div>
			{comments.length > 0 ? (
				<ol className="post-comment-list">
					{comments.map((comment) => (
						<li className="post-comment" key={comment.id}>
							<header>
								<strong>{comment.nickname || "Anonymous"}</strong>
								<time dateTime={comment.createdAt}>
									{formatCommentDate(comment.createdAt)}
								</time>
							</header>
							<p>{comment.body}</p>
						</li>
					))}
				</ol>
			) : (
				<p className="post-comments-empty">No comments yet.</p>
			)}
			{commentsEnabled ? (
				<form className="post-comment-form" onSubmit={submitComment}>
					<label>
						Nickname
						<input
							type="text"
							value={nickname}
							maxLength={80}
							placeholder="Anonymous"
							onChange={(event) => setNickname(event.currentTarget.value)}
						/>
					</label>
					<label>
						Comment
						<textarea
							value={body}
							maxLength={2000}
							rows={4}
							required
							onChange={(event) => setBody(event.currentTarget.value)}
						/>
					</label>
					{access.enabled && access.siteKey ? (
						<TurnstileWidget
							siteKey={access.siteKey}
							action="comment"
							resetSignal={resetSignal}
							onToken={onTurnstileToken}
						/>
					) : null}
					{message ? (
						<p
							className={`state-note${message === "Comment posted." ? "" : " state-error"}`}
						>
							{message}
						</p>
					) : null}
					<button type="submit" disabled={submitting}>
						{submitting ? "Posting..." : "Post comment"}
					</button>
				</form>
			) : (
				<p className="post-comments-empty">Comments are closed.</p>
			)}
		</section>
	);
}

export function PostDetail({
	post,
	backHref = "/",
	backLabel = "All posts",
}: {
	post: PublicPostDetail;
	backHref?: string;
	backLabel?: string;
}) {
	const tags = post.tags ?? [];
	const category = post.category?.trim() ?? "";

	return (
		<article className="post-detail">
			<header className="post-detail-header">
				<Link className="back-link" to={backHref}>
					{backLabel}
				</Link>
				<p className="post-meta">
					<time dateTime={post.publishedAt ?? post.updatedAt}>
						{formatDate(post.publishedAt ?? post.updatedAt)}
					</time>
				</p>
				<h1>{post.title}</h1>
				{tags.length > 0 || category ? (
					<div className="post-taxonomy-row">
						{tags.length > 0 ? (
							<div className="post-tags detail-tags" aria-label="Post tags">
								{tags.map((tag) => (
									<span className="post-tag" key={tag}>
										{tag}
									</span>
								))}
							</div>
						) : (
							<div />
						)}
						{category ? (
							<div
								className="post-category detail-category"
								aria-label="Post category"
							>
								{category}
							</div>
						) : null}
					</div>
				) : null}
			</header>
			<Markdown markdown={post.markdown} />
			<PostComments post={post} />
		</article>
	);
}
