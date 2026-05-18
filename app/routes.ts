import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
	index("routes/home.tsx"),
	route("post/:slug", "routes/post.tsx"),
	route("tags/:tag", "routes/tag.tsx"),
	route("search", "routes/search.tsx"),
	route("admin/*", "routes/admin.tsx"),
] satisfies RouteConfig;
