import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router";

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

const sectionTitles: Record<AdminSection, { eyebrow: string; title: string }> = {
	overview: { eyebrow: "Admin console", title: "Dashboard" },
	settings: { eyebrow: "Admin console", title: "Settings" },
	sync: { eyebrow: "Admin console", title: "Sync management" },
	posts: { eyebrow: "Admin console", title: "Posts" },
	album: { eyebrow: "Admin console", title: "Album" },
	comments: { eyebrow: "Admin console", title: "Comments" },
};

function sectionForPath(pathname: string): AdminSection {
	const allSections = [...siteSections, ...settingsSections];
	const match = allSections.find((section) => pathname.startsWith(section.path));

	return match?.id ?? "overview";
}

export function AdminShell({
	onLogout,
	children,
	mustChangePassword,
}: {
	onLogout: () => void;
	children: ReactNode;
	mustChangePassword?: boolean;
}) {
	const location = useLocation();
	const currentSection = sectionTitles[sectionForPath(location.pathname)];

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
					<div className="admin-sidebar-status" aria-live="polite">
						<span />
						{mustChangePassword ? "Password change required" : "Secure session"}
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
									<span className="admin-nav-dot" aria-hidden="true" />
									<span>{section.label}</span>
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
									<span className="admin-nav-dot" aria-hidden="true" />
									<span>{section.label}</span>
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
							<p className="admin-eyebrow">{currentSection.eyebrow}</p>
							<h1>{currentSection.title}</h1>
						</div>
						<a className="admin-topbar-link" href="/">
							View site
						</a>
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
