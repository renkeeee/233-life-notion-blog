import { Link } from "react-router";

export type PublicPostSummary = {
	id: string;
	slug: string;
	title: string;
	excerpt: string;
	coverUrl: string | null;
	coverThumbnailUrl?: string | null;
	category: string | null;
	tags: string[];
	publishedAt: string | null;
	updatedAt: string;
};

type PostListProps = {
	posts: PublicPostSummary[];
	postHref?: (post: PublicPostSummary) => string;
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

export function PostList({
	posts,
	postHref = (post) => `/post/${post.slug}`,
}: PostListProps) {
	return (
		<div className="post-list">
			{posts.map((post, index) => {
				const excerpt = post.excerpt?.trim() ?? "";
				const href = postHref(post);
				const coverSrc = post.coverThumbnailUrl || post.coverUrl;
				const coverSrcSet =
					post.coverThumbnailUrl && post.coverUrl
						? `${post.coverThumbnailUrl} 440w, ${post.coverUrl} 900w`
						: undefined;

				return (
					<article className="post-list-item" key={post.id}>
						{post.coverUrl && coverSrc ? (
							<Link className="post-list-cover" to={href}>
								<img
									src={coverSrc}
									srcSet={coverSrcSet}
									sizes="(max-width: 720px) 100vw, 220px"
									alt=""
									loading={index === 0 ? "eager" : "lazy"}
									fetchPriority={index === 0 ? "high" : "auto"}
									onError={(event) => {
										if (
											post.coverThumbnailUrl &&
											post.coverUrl &&
											event.currentTarget.src !== post.coverUrl
										) {
											event.currentTarget.src = post.coverUrl;
										}
									}}
								/>
							</Link>
						) : null}
						<div className="post-list-body">
							<div className="post-meta">
								<time dateTime={post.publishedAt ?? post.updatedAt}>
									{formatDate(post.publishedAt ?? post.updatedAt)}
								</time>
							</div>
							<h2>
								<Link to={href}>{post.title}</Link>
							</h2>
							{excerpt ? <p className="post-excerpt">{excerpt}</p> : null}
						</div>
					</article>
				);
			})}
		</div>
	);
}
