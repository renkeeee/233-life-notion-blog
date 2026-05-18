import { BrowserRouter, Route, Routes } from "react-router";
import Admin from "./routes/admin";
import Home from "./routes/home";
import Post from "./routes/post";
import Search from "./routes/search";
import Tag from "./routes/tag";

function NotFound() {
	return <main className="mx-auto max-w-5xl px-4 py-10">Not found</main>;
}

export default function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route index element={<Home />} />
				<Route path="post/:slug" element={<Post />} />
				<Route path="tags/:tag" element={<Tag />} />
				<Route path="search" element={<Search />} />
				<Route path="admin/*" element={<Admin />} />
				<Route path="*" element={<NotFound />} />
			</Routes>
		</BrowserRouter>
	);
}
