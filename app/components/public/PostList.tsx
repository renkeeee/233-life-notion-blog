import { Link } from "react-router";

export type PublicPostSummary = {
	id: string;
	slug: string;
	title: string;
	summary: string | null;
	coverUrl: string | null;
	tags: string[];
	publishedAt: string | null;
	updatedAt: string;
};

function formatDate(value: string | null): string {
	if (!value) {
		return "Draft date";
	}

	return new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		year: "numeric",
	}).format(new Date(value));
}

export function PostList({ posts }: { posts: PublicPostSummary[] }) {
	return (
		<div className="post-list">
			{posts.map((post) => (
				<article className="post-list-item" key={post.id}>
					{post.coverUrl ? (
						<Link className="post-list-cover" to={`/post/${post.slug}`}>
							<img src={post.coverUrl} alt="" loading="lazy" />
						</Link>
					) : null}
					<div className="post-list-body">
						<div className="post-meta">
							<time dateTime={post.publishedAt ?? post.updatedAt}>
								{formatDate(post.publishedAt)}
							</time>
						</div>
						<h2>
							<Link to={`/post/${post.slug}`}>{post.title}</Link>
						</h2>
						{post.summary ? <p>{post.summary}</p> : null}
						{post.tags.length > 0 ? (
							<nav className="tag-row" aria-label={`Tags for ${post.title}`}>
								{post.tags.map((tag) => (
									<Link key={tag} to={`/tags/${encodeURIComponent(tag)}`}>
										{tag}
									</Link>
								))}
							</nav>
						) : null}
					</div>
				</article>
			))}
		</div>
	);
}
