import type { ReactNode } from "react";
import { NavLink } from "react-router";

export type AdminSection =
	| "overview"
	| "settings"
	| "sync"
	| "posts"
	| "album"
	| "comments";

const siteSections: Array<{ id: AdminSection; label: string; path: string }> = [
	{ id: "overview", label: "Overview", path: "/admin/overview" },
	{ id: "posts", label: "Posts", path: "/admin/posts" },
	{ id: "sync", label: "Sync", path: "/admin/sync" },
	{ id: "album", label: "Album", path: "/admin/album" },
];

const settingsSections: Array<{ id: AdminSection; label: string; path: string }> = [
	{ id: "settings", label: "Settings", path: "/admin/settings" },
	{ id: "comments", label: "Comments", path: "/admin/comments" },
];

export function AdminShell({
	onLogout,
	children,
	mustChangePassword,
}: {
	onLogout: () => void;
	children: ReactNode;
	mustChangePassword?: boolean;
}) {
	return (
		<main className="admin-shell">
			<div className="admin-layout">
				<aside className="admin-sidebar" aria-label="Admin navigation">
					<div className="admin-brand">
						<span className="admin-brand-mark">23</span>
						<div>
							<p className="admin-eyebrow">Notion Blog</p>
							<strong>233.life</strong>
						</div>
					</div>

					<nav className="admin-side-nav" aria-label="Admin sections">
						<div className="admin-nav-group">
							<p>Site</p>
							{siteSections.map((section) => (
								<NavLink
									key={section.id}
									to={section.path}
									className={({ isActive }) => (isActive ? "active" : undefined)}
								>
									{section.label}
								</NavLink>
							))}
						</div>
						<div className="admin-nav-group">
							<p>Settings</p>
							{settingsSections.map((section) => (
								<NavLink
									key={section.id}
									to={section.path}
									className={({ isActive }) => (isActive ? "active" : undefined)}
								>
									{section.label}
								</NavLink>
							))}
						</div>
					</nav>

					<button
						className="admin-sidebar-logout"
						type="button"
						onClick={onLogout}
					>
						Log out
					</button>
				</aside>

				<section className="admin-main">
					<header className="admin-topbar">
						<div>
							<p className="admin-eyebrow">Admin console</p>
							<h1>Dashboard</h1>
						</div>
					</header>

					{mustChangePassword ? (
						<p className="admin-banner">
							The initial password must be changed before settings and sync actions
							are available.
						</p>
					) : null}

					<section className="admin-panel">{children}</section>
				</section>
			</div>
		</main>
	);
}
