import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api-client";

type AdminPostRecord = {
	id: string;
	title?: string | null;
	slug?: string | null;
	status?: string | null;
	visibility?: string | null;
	notionLastEditedTime?: string | null;
	updatedAt?: string | null;
	lastSyncError?: string | null;
};

type PostsResponse =
	| { items: AdminPostRecord[]; total?: number }
	| AdminPostRecord[];

function responseItems(response: PostsResponse): AdminPostRecord[] {
	return Array.isArray(response) ? response : response.items;
}

function postTitle(post: AdminPostRecord): string {
	return post.title?.trim() || "Untitled";
}

export function PostStatusTable() {
	const [posts, setPosts] = useState<AdminPostRecord[]>([]);
	const [status, setStatus] = useState("Loading post status...");

	useEffect(() => {
		let cancelled = false;

		apiGet<PostsResponse>("/api/admin/posts")
			.then((response) => {
				if (cancelled) {
					return;
				}

				const items = responseItems(response);
				setPosts(items);
				setStatus(items.length ? `${items.length} synced posts` : "No posts synced yet.");
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setStatus(
						error instanceof Error
							? `${error.message}. Post status endpoint is not available yet.`
							: "Post status endpoint is not available yet.",
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="admin-stack">
			<div className="admin-section-heading">
				<h2>Post status</h2>
				<span className="admin-badge">Database view</span>
			</div>
			<p className="admin-note">{status}</p>
			{posts.length > 0 ? (
				<div className="admin-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>Title</th>
								<th>Slug</th>
								<th>Status</th>
								<th>Visibility</th>
								<th>Updated</th>
								<th>Sync error</th>
							</tr>
						</thead>
						<tbody>
							{posts.map((post) => (
								<tr key={post.id}>
									<td>{postTitle(post)}</td>
									<td>{post.slug ?? "-"}</td>
									<td>{post.status ?? "-"}</td>
									<td>{post.visibility ?? "-"}</td>
									<td>{post.notionLastEditedTime ?? post.updatedAt ?? "-"}</td>
									<td>{post.lastSyncError ?? "-"}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : null}
		</div>
	);
}
