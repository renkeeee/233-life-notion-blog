import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
	return [
		{ title: "233 Life" },
		{ name: "description", content: "A Notion-backed personal blog." },
	];
}

export default function Home() {
	return <main className="mx-auto max-w-5xl px-4 py-10">Loading posts...</main>;
}
