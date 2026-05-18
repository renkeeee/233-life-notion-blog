import type { ReactNode } from "react";

export type AdminTab = "overview" | "settings" | "sync" | "posts";

const tabs: Array<{ id: AdminTab; label: string }> = [
	{ id: "overview", label: "Overview" },
	{ id: "settings", label: "Settings" },
	{ id: "sync", label: "Sync" },
	{ id: "posts", label: "Posts" },
];

export function AdminShell({
	activeTab,
	onTabChange,
	onLogout,
	children,
	mustChangePassword,
}: {
	activeTab: AdminTab;
	onTabChange: (tab: AdminTab) => void;
	onLogout: () => void;
	children: ReactNode;
	mustChangePassword?: boolean;
}) {
	return (
		<main className="admin-shell">
			<header className="admin-topbar">
				<div>
					<p className="admin-eyebrow">Notion Blog</p>
					<h1>Admin console</h1>
				</div>
				<button className="admin-secondary-button" type="button" onClick={onLogout}>
					Log out
				</button>
			</header>

			{mustChangePassword ? (
				<p className="admin-banner">
					The initial password must be changed before settings and sync actions are
					available.
				</p>
			) : null}

			<nav className="admin-tabs" aria-label="Admin sections">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						className={tab.id === activeTab ? "active" : ""}
						onClick={() => onTabChange(tab.id)}
					>
						{tab.label}
					</button>
				))}
			</nav>

			<section className="admin-panel">{children}</section>
		</main>
	);
}
