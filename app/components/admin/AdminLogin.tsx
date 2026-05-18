import { useState } from "react";
import type { FormEvent } from "react";

export function AdminLogin({
	onLogin,
	error,
}: {
	onLogin: (password: string) => Promise<void> | void;
	error?: string | null;
}) {
	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSubmitting(true);
		try {
			await onLogin(password);
		} finally {
			setSubmitting(false);
		}
	}

	return (
		<form className="admin-login" onSubmit={submit}>
			<div>
				<p className="admin-eyebrow">Admin</p>
				<h1>Blog console</h1>
			</div>
			<input
				type="text"
				name="username"
				value="admin"
				autoComplete="username"
				readOnly
				hidden
			/>
			<label>
				Password
				<input
					type="password"
					value={password}
					onChange={(event) => setPassword(event.currentTarget.value)}
					autoComplete="current-password"
				/>
			</label>
			{error ? <p className="admin-error">{error}</p> : null}
			<button type="submit" disabled={submitting}>
				{submitting ? "Logging in..." : "Log in"}
			</button>
		</form>
	);
}
