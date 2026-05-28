import { Fragment, useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
	Navigate,
	NavLink,
	Route,
	Routes,
	useLocation,
	useNavigate,
	useSearchParams,
} from "react-router";
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
	const syncAttentionSummary = latestSync
		? `Latest sync: ${latestSync.status}${
				latestSync.failedCount
					? `, ${latestSync.failedCount} failed item${
							latestSync.failedCount === 1 ? "" : "s"
						}`
					: ""
			}${latestSync.errorMessage ? ` (${latestSync.errorMessage})` : ""}`
		: "Latest sync: no sync runs";
	const latestComment = data?.recentComments[0] ?? null;

	return (
		<div className="admin-stack">
			<div className="admin-section-heading">
				<h2>Operations</h2>
				{mustChangePassword ? (
					<span className="admin-badge warning">Password required</span>
				) : null}
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
				<p className="admin-sync-tip" role="status">
					<strong>Sync attention</strong>
					<span>
						{syncAttentionSummary}
						{data.failedPosts.length > 0
							? data.failedPosts.map((post) => (
									<Fragment key={post.id}>
										{" / "}
										{post.title}: <em>{post.lastSyncError}</em>
									</Fragment>
								))
							: null}
					</span>
				</p>
			) : null}
			<div className="admin-overview-grid" aria-busy={state.status === "loading"}>
				<div className="admin-stat-card">
					<strong>Total posts</strong>
					<span>{data ? data.counts.totalPosts : "-"}</span>
				</div>
				<div className="admin-stat-card">
					<strong>Published</strong>
					<span>{data ? data.counts.publishedPosts : "-"}</span>
				</div>
				<div className="admin-stat-card">
					<strong>Hidden</strong>
					<span>{data ? data.counts.hiddenPosts : "-"}</span>
				</div>
				<div className="admin-stat-card">
					<strong>Locked</strong>
					<span>{data ? data.counts.lockedPosts : "-"}</span>
				</div>
				<div className="admin-stat-card">
					<strong>Comments</strong>
					<span>{data ? data.counts.comments : "-"}</span>
				</div>
				<div className="admin-stat-card wide">
					<strong>Last sync</strong>
					<span>
						{latestSync
							? `${latestSync.status} / ${formatAdminDate(latestSync.startedAt)}`
							: "No sync runs"}
					</span>
				</div>
				<NavLink
					className="admin-stat-card admin-stat-card-link wide"
					to="/admin/comments"
				>
					<strong>Recent comments</strong>
					<span>
						{data
							? `${data.counts.comments} total comment${
									data.counts.comments === 1 ? "" : "s"
								}`
							: "-"}
					</span>
					{latestComment ? (
						<small>
							{latestComment.nickname || "Anonymous"} on{" "}
							{latestComment.postTitle}: <em>{latestComment.body}</em>
						</small>
					) : data ? (
						<small>No comments yet.</small>
					) : null}
				</NavLink>
			</div>
		</div>
	);
}

function PostStatusRoute({ csrfToken }: { csrfToken: string }) {
	const location = useLocation();
	const navigate = useNavigate();
	const [searchParams] = useSearchParams();
	const draftId = searchParams.get("draftId");
	const immersive = searchParams.get("immersive") === "1";

	if (location.pathname.endsWith("/edit") && !draftId) {
		return <Navigate to="/admin/posts" replace />;
	}

	function navigateToDraft(nextDraftId: string | null) {
		if (!nextDraftId) {
			navigate("/admin/posts");
			return;
		}

		navigate(`/admin/posts/edit?draftId=${encodeURIComponent(nextDraftId)}`);
	}

	function setImmersive(nextImmersive: boolean) {
		if (!draftId) {
			return;
		}

		const nextParams = new URLSearchParams(searchParams);
		nextParams.set("draftId", draftId);
		if (nextImmersive) {
			nextParams.set("immersive", "1");
		} else {
			nextParams.delete("immersive");
		}

		navigate(`/admin/posts/edit?${nextParams.toString()}`, { replace: true });
	}

	return (
		<PostStatusTable
			csrfToken={csrfToken}
			editorDraftId={draftId}
			immersive={immersive}
			onEditorDraftIdChange={navigateToDraft}
			onImmersiveChange={setImmersive}
		/>
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
			<main className="admin-shell admin-checking-shell">
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
					element={<Navigate to="/admin/source" replace />}
				/>
				<Route
					path="password"
					element={
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
					}
				/>
				<Route
					path="source"
					element={
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
					element={<PostStatusRoute csrfToken={session.csrfToken} />}
				/>
				<Route
					path="posts/edit"
					element={<PostStatusRoute csrfToken={session.csrfToken} />}
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
