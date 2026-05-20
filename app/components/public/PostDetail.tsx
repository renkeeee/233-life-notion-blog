import { Link } from "react-router";
import { Markdown } from "../../lib/markdown";
import type { PublicPostSummary } from "./PostList";

export type PublicPostDetail = PublicPostSummary & {
	markdown: string;
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
		</article>
	);
}
