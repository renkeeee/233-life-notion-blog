import { BrowserRouter, Route, Routes } from "react-router";
import Admin from "./routes/admin";
import DemoHome from "./routes/demo";
import Home from "./routes/home";
import Post from "./routes/post";
import Search from "./routes/search";

function NotFound() {
	return <main className="mx-auto max-w-5xl px-4 py-10">Not found</main>;
}

export default function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route index element={<Home />} />
				<Route path="demo" element={<DemoHome />} />
				<Route path="post/:slug" element={<Post />} />
				<Route path="search" element={<Search />} />
				<Route path="admin/*" element={<Admin />} />
				<Route path="*" element={<NotFound />} />
			</Routes>
		</BrowserRouter>
	);
}
