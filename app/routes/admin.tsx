import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router";
import "react-datepicker/dist/react-datepicker.css";
import { AlbumPanel } from "../components/admin/AlbumPanel";
import { AdminLogin } from "../components/admin/AdminLogin";
import { AdminShell } from "../components/admin/AdminShell";
import { CommentManagementPanel } from "../components/admin/CommentManagementPanel";
import { PostStatusTable } from "../components/admin/PostStatusTable";
import { SettingsPanel } from "../components/admin/SettingsPanel";
import { SyncPanel } from "../components/admin/SyncPanel";
import { apiGet, apiPost } from "../lib/api-client";

type MeResponse =
	| { authenticated: false }
	| { authenticated: true; csrfToken: string; mustChangePassword?: boolean };

type SessionState =
	| { status: "checking" }
	| { status: "guest"; error?: string | null }
	| { status: "admin"; csrfToken: string; mustChangePassword: boolean };

type AdminOverviewResponse = {
	counts: {
		totalPosts: number;
		publishedPosts: number;
		hiddenPosts: number;
		lockedPosts: number;
		comments: number;
	};
	latestSyncRun: {
		id: string;
		triggerType: string;
		status: string;
		startedAt: string;
		finishedAt: string | null;
		failedCount: number;
		errorMessage: string | null;
	} | null;
	failedPosts: Array<{
		id: string;
		title: string;
		slug: string;
		lastSyncError: string;
		updatedAt: string;
	}>;
	recentComments: Array<{
		id: string;
		nickname: string;
		body: string;
		createdAt: string;
		postId: string;
		postTitle: string;
		postSlug: string;
	}>;
};

type OverviewState =
	| { status: "locked" }
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "success"; data: AdminOverviewResponse };

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

function formatAdminDate(value: string | null): string {
	if (!value) {
		return "-";
	}

	return new Intl.DateTimeFormat("en", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(value));
}

export function PasswordChangePanel({
	csrfToken,
	onChanged,
	required = false,
	headingId,
	layout = "compact",
}: {
	csrfToken: string;
	onChanged: () => void;
	required?: boolean;
	headingId?: string;
	layout?: "compact" | "fluid";
}) {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmNewPassword, setConfirmNewPassword] = useState("");
	const [status, setStatus] = useState(
		required
			? "Change the initial password before using protected admin actions."
			: "Use this form to update your admin password.",
	);
	const [submitting, setSubmitting] = useState(false);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (newPassword !== confirmNewPassword) {
			setStatus("New passwords do not match.");
			return;
		}

		setSubmitting(true);
		setStatus("Updating password...");
		try {
			await apiPost(
				"/api/admin/password",
				{ currentPassword, newPassword },
				csrfToken,
			);
			setCurrentPassword("");
			setNewPassword("");
			setConfirmNewPassword("");
			setStatus("Password changed.");
			onChanged();
		} catch (error) {
			setStatus(errorMessage(error, "Password could not be changed."));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form className={`admin-form ${layout}`} onSubmit={submit}>
			<div className="admin-section-heading">
				<h2 id={headingId}>Password</h2>
				<span className={required ? "admin-badge warning" : "admin-badge"}>
					{required ? "Required" : "Optional"}
				</span>
			</div>
			<label>
				Current password
				<input
					type="password"
					value={currentPassword}
					onChange={(event) => setCurrentPassword(event.currentTarget.value)}
					autoComplete="current-password"
				/>
			</label>
			<label>
				New password
				<input
					type="password"
					value={newPassword}
					onChange={(event) => setNewPassword(event.currentTarget.value)}
					autoComplete="new-password"
				/>
			</label>
			<label>
				Confirm new password
				<input
					type="password"
					value={confirmNewPassword}
					onChange={(event) => setConfirmNewPassword(event.currentTarget.value)}
					autoComplete="new-password"
				/>
			</label>
			<p className="admin-note">{status}</p>
			<button type="submit" disabled={submitting}>
				{submitting ? "Changing..." : "Change password"}
			</button>
		</form>
	);
}

function Overview({
	mustChangePassword,
}: {
	mustChangePassword: boolean;
}) {
	const [state, setState] = useState<OverviewState>(
		mustChangePassword ? { status: "locked" } : { status: "loading" },
	);

	useEffect(() => {
		if (mustChangePassword) {
			setState({ status: "locked" });
			return;
		}

		let cancelled = false;
		setState({ status: "loading" });
		apiGet<AdminOverviewResponse>("/api/admin/overview")
			.then((data) => {
				if (!cancelled) {
					setState({ status: "success", data });
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setState({
						status: "error",
						message: errorMessage(error, "Overview could not be loaded."),
					});
				}
			});

		return () => {
			cancelled = true;
		};
	}, [mustChangePassword]);

	const data = state.status === "success" ? state.data : null;
	const latestSync = data?.latestSyncRun ?? null;
	const needsAttention =
		latestSync?.status === "failed" ||
		latestSync?.status === "partial" ||
		(latestSync?.failedCount ?? 0) > 0 ||
		(data?.failedPosts.length ?? 0) > 0;

	return (
		<div className="admin-stack">
			<div className="admin-section-heading">
				<h2>Operations</h2>
				<span className={mustChangePassword ? "admin-badge warning" : "admin-badge"}>
					{mustChangePassword ? "Password required" : "Ready"}
				</span>
			</div>
			{state.status === "locked" ? (
				<p className="admin-warning">
					Change the initial password before loading operational metrics.
				</p>
			) : null}
			{state.status === "loading" ? (
				<p className="admin-note">Loading overview...</p>
			) : null}
			{state.status === "error" ? (
				<p className="admin-error">{state.message}</p>
			) : null}
			{data && needsAttention ? (
				<section className="admin-module admin-warning-module">
					<div className="admin-section-heading compact">
						<h3>Sync attention</h3>
						<span className="admin-badge warning">Review</span>
					</div>
					{latestSync ? (
						<p className="admin-note">
							Latest sync: {latestSync.status}
							{latestSync.failedCount
								? `, ${latestSync.failedCount} failed item${
										latestSync.failedCount === 1 ? "" : "s"
									}`
								: ""}
							{latestSync.errorMessage ? ` (${latestSync.errorMessage})` : ""}
						</p>
					) : null}
					{data.failedPosts.length > 0 ? (
						<ul className="admin-compact-list">
							{data.failedPosts.map((post) => (
								<li key={post.id}>
									<strong>{post.title}</strong>
									<span>{post.lastSyncError}</span>
								</li>
							))}
						</ul>
					) : null}
				</section>
			) : null}
			<div className="admin-overview-grid">
				<div>
					<strong>Total posts</strong>
					<span>{data ? data.counts.totalPosts : "-"}</span>
				</div>
				<div>
					<strong>Published</strong>
					<span>{data ? data.counts.publishedPosts : "-"}</span>
				</div>
				<div>
					<strong>Hidden</strong>
					<span>{data ? data.counts.hiddenPosts : "-"}</span>
				</div>
				<div>
					<strong>Locked</strong>
					<span>{data ? data.counts.lockedPosts : "-"}</span>
				</div>
				<div>
					<strong>Comments</strong>
					<span>{data ? data.counts.comments : "-"}</span>
				</div>
				<div>
					<strong>Last sync</strong>
					<span>
						{latestSync
							? `${latestSync.status} / ${formatAdminDate(latestSync.startedAt)}`
							: "No sync runs"}
					</span>
				</div>
			</div>
			{data ? (
				<section className="admin-module">
					<div className="admin-section-heading compact">
						<h3>Recent comments</h3>
						<span className="admin-badge">{data.recentComments.length}</span>
					</div>
					{data.recentComments.length > 0 ? (
						<ul className="admin-compact-list">
							{data.recentComments.map((comment) => (
								<li key={comment.id}>
									<strong>
										{comment.nickname || "Anonymous"} on {comment.postTitle}
									</strong>
									<span>{comment.body}</span>
								</li>
							))}
						</ul>
					) : (
						<p className="admin-note">No comments yet.</p>
					)}
				</section>
			) : null}
		</div>
	);
}

export default function Admin() {
	const [session, setSession] = useState<SessionState>({ status: "checking" });

	useEffect(() => {
		let cancelled = false;

		apiGet<MeResponse>("/api/admin/me")
			.then((response) => {
				if (cancelled) {
					return;
				}

				if (response.authenticated) {
					setSession({
						status: "admin",
						csrfToken: response.csrfToken,
						mustChangePassword: response.mustChangePassword === true,
					});
				} else {
					setSession({ status: "guest" });
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setSession({
						status: "guest",
						error: errorMessage(error, "Admin session could not be checked."),
					});
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	async function login(password: string) {
		setSession({ status: "guest" });
		try {
			const response = await apiPost<MeResponse>("/api/admin/login", {
				password,
			});
			if (!response.authenticated) {
				setSession({ status: "guest", error: "Invalid credentials." });
				return;
			}
			setSession({
				status: "admin",
				csrfToken: response.csrfToken,
				mustChangePassword: response.mustChangePassword === true,
			});
		} catch (error) {
			setSession({
				status: "guest",
				error: errorMessage(error, "Unable to log in."),
			});
		}
	}

	async function logout() {
		if (session.status !== "admin") {
			setSession({ status: "guest" });
			return;
		}

		try {
			await apiPost("/api/admin/logout", {}, session.csrfToken);
		} finally {
			setSession({ status: "guest" });
		}
	}

	function markPasswordChanged() {
		if (session.status !== "admin") {
			return;
		}

		setSession({
			status: "admin",
			csrfToken: session.csrfToken,
			mustChangePassword: false,
		});
	}

	if (session.status === "checking") {
		return (
			<main className="admin-shell">
				<p className="admin-note">Checking admin session...</p>
			</main>
		);
	}

	if (session.status === "guest") {
		return <AdminLogin onLogin={login} error={session.error} />;
	}

	return (
		<AdminShell
			onLogout={logout}
			mustChangePassword={session.mustChangePassword}
		>
			<Routes>
				<Route index element={<Navigate to="overview" replace />} />
				<Route
					path="overview"
					element={<Overview mustChangePassword={session.mustChangePassword} />}
				/>
				<Route
					path="settings"
					element={
						<div className="admin-settings-layout">
							<section
								className="admin-module"
								aria-labelledby="admin-password-heading"
							>
								<PasswordChangePanel
									csrfToken={session.csrfToken}
									required={session.mustChangePassword}
									onChanged={markPasswordChanged}
									headingId="admin-password-heading"
									layout="fluid"
								/>
							</section>
							<section
								className="admin-module"
								aria-labelledby="admin-data-source-heading"
							>
								<SettingsPanel
									csrfToken={session.csrfToken}
									disabled={session.mustChangePassword}
									headingId="admin-data-source-heading"
								/>
							</section>
							<section
								className="admin-module admin-settings-entry-card"
								aria-labelledby="admin-comments-entry-heading"
							>
								<div className="admin-section-heading compact">
									<h2 id="admin-comments-entry-heading">Comment management</h2>
									<span className="admin-badge">Comments</span>
								</div>
								<p className="admin-note">
									Review pending comments, reply to visitors, delete comments,
									and adjust comment settings from one dedicated page.
								</p>
								<NavLink className="admin-secondary-button" to="/admin/comments">
									Comment management
								</NavLink>
							</section>
						</div>
					}
				/>
				<Route
					path="sync"
					element={
						<SyncPanel
							csrfToken={session.csrfToken}
							disabled={session.mustChangePassword}
						/>
					}
				/>
				<Route
					path="posts"
					element={<PostStatusTable csrfToken={session.csrfToken} />}
				/>
				<Route path="album" element={<AlbumPanel csrfToken={session.csrfToken} />} />
				<Route
					path="comments"
					element={<CommentManagementPanel csrfToken={session.csrfToken} />}
				/>
				<Route path="*" element={<Navigate to="/admin/overview" replace />} />
			</Routes>
		</AdminShell>
	);
}
