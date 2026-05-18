import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AdminLogin } from "../components/admin/AdminLogin";
import { AdminShell, type AdminTab } from "../components/admin/AdminShell";
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

function errorMessage(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

function PasswordChangePanel({
	csrfToken,
	onChanged,
}: {
	csrfToken: string;
	onChanged: () => void;
}) {
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [status, setStatus] = useState(
		"Change the initial password before using protected admin actions.",
	);
	const [submitting, setSubmitting] = useState(false);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
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
			setStatus("Password changed.");
			onChanged();
		} catch (error) {
			setStatus(errorMessage(error, "Password could not be changed."));
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form className="admin-form compact" onSubmit={submit}>
			<div className="admin-section-heading">
				<h2>Password</h2>
				<span className="admin-badge warning">Required</span>
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
	return (
		<div className="admin-stack">
			<div className="admin-section-heading">
				<h2>Operations</h2>
				<span className={mustChangePassword ? "admin-badge warning" : "admin-badge"}>
					{mustChangePassword ? "Password required" : "Ready"}
				</span>
			</div>
			<div className="admin-overview-grid">
				<div>
					<strong>Data source</strong>
					<span>Configure the Notion database, token, field mapping, and CDN URL.</span>
				</div>
				<div>
					<strong>Refresh</strong>
					<span>Run manual syncs with optional date ranges and force refresh.</span>
				</div>
				<div>
					<strong>Status</strong>
					<span>Review synced posts and backend sync history as endpoints land.</span>
				</div>
			</div>
		</div>
	);
}

export default function Admin() {
	const [session, setSession] = useState<SessionState>({ status: "checking" });
	const [activeTab, setActiveTab] = useState<AdminTab>("overview");

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
			setActiveTab("overview");
		}
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

	const adminContent = (() => {
		if (activeTab === "settings") {
			return (
				<SettingsPanel
					csrfToken={session.csrfToken}
					disabled={session.mustChangePassword}
				/>
			);
		}

		if (activeTab === "sync") {
			return (
				<SyncPanel
					csrfToken={session.csrfToken}
					disabled={session.mustChangePassword}
				/>
			);
		}

		if (activeTab === "posts") {
			return <PostStatusTable />;
		}

		return (
			<>
				<Overview mustChangePassword={session.mustChangePassword} />
				{session.mustChangePassword ? (
					<PasswordChangePanel
						csrfToken={session.csrfToken}
						onChanged={() =>
							setSession({
								status: "admin",
								csrfToken: session.csrfToken,
								mustChangePassword: false,
							})
						}
					/>
				) : null}
			</>
		);
	})();

	return (
		<AdminShell
			activeTab={activeTab}
			onTabChange={setActiveTab}
			onLogout={logout}
			mustChangePassword={session.mustChangePassword}
		>
			{adminContent}
		</AdminShell>
	);
}
