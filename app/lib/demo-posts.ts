import type { PublicPostDetail } from "../components/public/PostDetail";

export const demoPosts: PublicPostDetail[] = [
	{
		id: "demo-1",
		slug: "demo-slower-morning",
		title: "The shape of a slower morning",
		excerpt:
			"Tea cooling beside an open window, a page half-read, and the small decision to let the day arrive without hurry.",
		coverUrl:
			"https://images.unsplash.com/photo-1499728603263-13726abce5fd?auto=format&fit=crop&w=900&q=80",
		category: "Essays",
		tags: ["Quiet", "Morning", "Home"],
		publishedAt: "2026-05-12T08:30:00.000Z",
		updatedAt: "2026-05-12T08:30:00.000Z",
		markdown:
			"The morning did not ask to be optimized. It arrived with steam, light, and the small patience of an unread page.\n\nI kept the phone face down and let the kettle finish its little weather. Outside, the street was already practicing its weekday certainty, but the room held a softer grammar.\n\n- Warm cup\n- Open window\n- One paragraph before everything else",
	},
	{
		id: "demo-2",
		slug: "demo-train-window",
		title: "Notes from a train window",
		excerpt:
			"Fields move like paragraphs outside the glass. Every station leaves behind a sentence I almost remember.",
		coverUrl:
			"https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
		category: "Travel",
		tags: ["Travel", "Notes"],
		publishedAt: "2026-04-28T14:20:00.000Z",
		updatedAt: "2026-04-28T14:20:00.000Z",
		markdown:
			"Fields move like paragraphs outside the glass. Every station leaves behind a sentence I almost remember.\n\nThe train does not care about conclusions. It only offers sequences: roofs, orchards, a narrow river, then someone waiting with both hands in their pockets.",
	},
	{
		id: "demo-3",
		slug: "demo-desk-light",
		title: "Desk light at 11:43",
		excerpt:
			"A small circle of lamplight can make the rest of the room feel less like darkness and more like patience.",
		coverUrl:
			"https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=80",
		category: "Notes",
		tags: ["Work", "Night"],
		publishedAt: "2026-04-16T23:43:00.000Z",
		updatedAt: "2026-04-16T23:43:00.000Z",
		markdown:
			"A small circle of lamplight can make the rest of the room feel less like darkness and more like patience.\n\nAt night, work becomes strangely honest. The performance leaves first. Then only the page remains, waiting for one useful sentence.",
	},
	{
		id: "demo-4",
		slug: "demo-rain-in-april",
		title: "Rain in April",
		excerpt:
			"The city becomes softer under rain. Corners blur, umbrellas bloom, and errands learn a slower rhythm.",
		coverUrl:
			"https://images.unsplash.com/photo-1515694346937-94d85e41e6f0?auto=format&fit=crop&w=900&q=80",
		category: "Essays",
		tags: ["City", "Weather", "Quiet"],
		publishedAt: "2026-04-03T10:15:00.000Z",
		updatedAt: "2026-04-03T10:15:00.000Z",
		markdown:
			"The city becomes softer under rain. Corners blur, umbrellas bloom, and errands learn a slower rhythm.\n\nEven the traffic lights look less certain. Red pools on the pavement, green trembles in the gutter, and everyone becomes briefly careful with the world.",
	},
	{
		id: "demo-5",
		slug: "demo-pocket-list",
		title: "A pocket list for ordinary days",
		excerpt:
			"Buy pears. Call home. Walk one block farther than usual. Keep one corner of the afternoon unclaimed.",
		coverUrl: null,
		category: "Lists",
		tags: ["Daily", "Home"],
		publishedAt: "2026-03-21T09:00:00.000Z",
		updatedAt: "2026-03-21T09:00:00.000Z",
		markdown:
			"Buy pears. Call home. Walk one block farther than usual. Keep one corner of the afternoon unclaimed.\n\nSome days do not need an argument. They need a list small enough to fit inside a coat pocket.",
	},
	{
		id: "demo-6",
		slug: "demo-coffee-shop",
		title: "The corner table",
		excerpt:
			"Every neighborhood has a table where time sits down first. Mine is beside a fern and a scratched brass lamp.",
		coverUrl:
			"https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80",
		category: "Places",
		tags: ["City", "Coffee"],
		publishedAt: "2026-03-05T16:10:00.000Z",
		updatedAt: "2026-03-05T16:10:00.000Z",
		markdown:
			"Every neighborhood has a table where time sits down first. Mine is beside a fern and a scratched brass lamp.\n\nThe table is not especially comfortable, which may be why it helps. It asks you to stay awake to the room.",
	},
	{
		id: "demo-7",
		slug: "demo-shelf",
		title: "Things left on the shelf",
		excerpt:
			"Receipts, train tickets, a stone from the coast. Not keepsakes exactly, more like quiet proof of having passed through.",
		coverUrl:
			"https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=900&q=80",
		category: "Notes",
		tags: ["Memory", "Home"],
		publishedAt: "2026-02-18T18:25:00.000Z",
		updatedAt: "2026-02-18T18:25:00.000Z",
		markdown:
			"Receipts, train tickets, a stone from the coast. Not keepsakes exactly, more like quiet proof of having passed through.\n\nA shelf is a slow archive. It forgives disorder because it understands that memory rarely arrives alphabetized.",
	},
];

export function findDemoPostBySlug(slug: string): PublicPostDetail | null {
	return demoPosts.find((post) => post.slug === slug) ?? null;
}
