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

export function PostDetail({ post }: { post: PublicPostDetail }) {
	return (
		<article className="post-detail">
			<header className="post-detail-header">
				<Link className="back-link" to="/">
					All posts
				</Link>
				<p className="post-meta">
					<time dateTime={post.publishedAt ?? post.updatedAt}>
						{formatDate(post.publishedAt ?? post.updatedAt)}
					</time>
				</p>
				<h1>{post.title}</h1>
			</header>
			<Markdown markdown={post.markdown} />
		</article>
	);
}
