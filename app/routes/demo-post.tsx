import { Link, useParams } from "react-router";
import { PostDetail } from "../components/public/PostDetail";
import { findDemoPostBySlug } from "../lib/demo-posts";

export default function DemoPost() {
	const { slug } = useParams();
	const post = slug ? findDemoPostBySlug(slug) : null;

	return (
		<main className="public-shell narrow">
			{post ? (
				<PostDetail
					post={post}
					backHref="/demo"
					backLabel="All demo posts"
				/>
			) : (
				<div className="state-panel">
					<p className="state-note state-error">Demo post not found</p>
					<Link to="/demo">Return to demo posts</Link>
				</div>
			)}
		</main>
	);
}
