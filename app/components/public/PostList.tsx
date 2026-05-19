import { Link } from "react-router";

export type PublicPostSummary = {
	id: string;
	slug: string;
	title: string;
	coverUrl: string | null;
	tags: string[];
	publishedAt: string | null;
	updatedAt: string;
};

function formatDate(value: string | null): string {
	if (!value) {
		return "Undated";
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
			{posts.map((post) => {
				const tags = post.tags ?? [];

				return (
					<article className="post-list-item" key={post.id}>
						{post.coverUrl ? (
							<Link className="post-list-cover" to={`/post/${post.slug}`}>
								<img src={post.coverUrl} alt="" loading="lazy" />
							</Link>
						) : null}
						<div className="post-list-body">
							<div className="post-meta">
								<time dateTime={post.publishedAt ?? post.updatedAt}>
									{formatDate(post.publishedAt ?? post.updatedAt)}
								</time>
							</div>
							<h2>
								<Link to={`/post/${post.slug}`}>{post.title}</Link>
							</h2>
							{tags.length > 0 ? (
								<div className="post-tags" aria-label={`Tags for ${post.title}`}>
									{tags.map((tag) => (
										<span className="post-tag" key={tag}>
											{tag}
										</span>
									))}
								</div>
							) : null}
						</div>
					</article>
				);
			})}
		</div>
	);
}
