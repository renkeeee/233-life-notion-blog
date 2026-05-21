import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { AccessGate } from "./components/public/AccessGate";
import Home from "./routes/home";

const Admin = lazy(() => import("./routes/admin"));
const Album = lazy(() => import("./routes/album"));
const Archive = lazy(() => import("./routes/archive"));
const DemoHome = lazy(() => import("./routes/demo"));
const DemoPost = lazy(() => import("./routes/demo-post"));
const Post = lazy(() => import("./routes/post"));
const Search = lazy(() => import("./routes/search"));

function NotFound() {
	return <main className="mx-auto max-w-5xl px-4 py-10">Not found</main>;
}

export default function App() {
	return (
		<BrowserRouter>
			<AccessGate>
				<Suspense fallback={<main className="public-shell">Loading...</main>}>
					<Routes>
						<Route index element={<Home />} />
						<Route path="demo" element={<DemoHome />} />
						<Route path="demo/post/:slug" element={<DemoPost />} />
						<Route path="post/:slug" element={<Post />} />
						<Route path="search" element={<Search />} />
						<Route path="archive" element={<Archive />} />
						<Route path="album" element={<Album />} />
						<Route path="admin/*" element={<Admin />} />
						<Route path="*" element={<NotFound />} />
					</Routes>
				</Suspense>
			</AccessGate>
		</BrowserRouter>
	);
}
