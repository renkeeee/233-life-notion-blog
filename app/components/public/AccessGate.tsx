import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
	type ReactNode,
} from "react";
import { apiGet, apiPost } from "../../lib/api-client";
import { TurnstileWidget } from "./TurnstileWidget";

type AccessStatus = {
	enabled: boolean;
	verified: boolean;
	siteKey: string;
};

type AccessGateState =
	| { status: "loading" }
	| { status: "ready"; access: AccessStatus }
	| { status: "challenge"; access: AccessStatus; submitting: boolean; error: string | null }
	| { status: "error"; message: string };

type TurnstileAccessContextValue = {
	enabled: boolean;
	siteKey: string;
};

const TurnstileAccessContext = createContext<TurnstileAccessContextValue>({
	enabled: false,
	siteKey: "",
});

export function useTurnstileAccess(): TurnstileAccessContextValue {
	return useContext(TurnstileAccessContext);
}

export function AccessGate({ children }: { children: ReactNode }) {
	const [state, setState] = useState<AccessGateState>({ status: "loading" });
	const [resetSignal, setResetSignal] = useState(0);

	useEffect(() => {
		let cancelled = false;

		apiGet<AccessStatus>("/api/turnstile/access")
			.then((access) => {
				if (cancelled) {
					return;
				}

				setState(
					!access.enabled || access.verified
						? { status: "ready", access }
						: { status: "challenge", access, submitting: false, error: null },
				);
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setState({
						status: "error",
						message:
							error instanceof Error
								? error.message
								: "Access verification could not be loaded.",
					});
				}
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const submitToken = useCallback(
		async (turnstileToken: string) => {
			if (state.status !== "challenge" || !turnstileToken) {
				return;
			}

			setState({ ...state, submitting: true, error: null });
			try {
				const access = await apiPost<AccessStatus>("/api/turnstile/access", {
					turnstileToken,
				});
				setState({ status: "ready", access });
			} catch (error) {
				setResetSignal((current) => current + 1);
				setState({
					...state,
					submitting: false,
					error:
						error instanceof Error
							? error.message
							: "Turnstile verification failed.",
				});
			}
		},
		[state],
	);

	if (state.status === "loading") {
		return (
			<main className="public-shell narrow">
				<div className="access-gate-panel" aria-busy="true" role="status">
					<p className="eyebrow">233.life</p>
					<h1>Checking access</h1>
				</div>
			</main>
		);
	}

	if (state.status === "error") {
		return (
			<main className="public-shell narrow">
				<div className="access-gate-panel">
					<p className="eyebrow">233.life</p>
					<h1>Access check failed</h1>
					<p className="state-note state-error">{state.message}</p>
				</div>
			</main>
		);
	}

	if (state.status === "challenge") {
		return (
			<main className="public-shell narrow">
				<div className="access-gate-panel">
					<p className="eyebrow">233.life</p>
					<h1>Verify access</h1>
					<p>
						Complete the quick check before entering the site.
					</p>
					<TurnstileWidget
						siteKey={state.access.siteKey}
						action="site-access"
						resetSignal={resetSignal}
						onToken={submitToken}
					/>
					{state.submitting ? <p className="state-note">Verifying...</p> : null}
					{state.error ? (
						<p className="state-note state-error">{state.error}</p>
					) : null}
				</div>
			</main>
		);
	}

	return (
		<TurnstileAccessContext.Provider
			value={{
				enabled: state.access.enabled,
				siteKey: state.access.siteKey,
			}}
		>
			{children}
		</TurnstileAccessContext.Provider>
	);
}
