import { Link } from "react-router";
import { Markdown } from "../../lib/markdown";
import type { PublicPostSummary } from "./PostList";

export type PublicPostDetail = PublicPostSummary & {
	markdown: string;
};

function formatDate(value: string | null): string {
	if (!value) {
		return "Unpublished";
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
						{formatDate(post.publishedAt)}
					</time>
				</p>
				<h1>{post.title}</h1>
				{post.summary ? <p className="post-summary">{post.summary}</p> : null}
				{post.tags.length > 0 ? (
					<nav className="tag-row" aria-label={`Tags for ${post.title}`}>
						{post.tags.map((tag) => (
							<Link key={tag} to={`/tags/${encodeURIComponent(tag)}`}>
								{tag}
							</Link>
						))}
					</nav>
				) : null}
			</header>
			{post.coverUrl ? (
				<img className="post-hero-image" src={post.coverUrl} alt="" />
			) : null}
			<Markdown markdown={post.markdown} />
		</article>
	);
}
