import { useEffect, useRef, useState } from "react";

type TurnstileWidgetProps = {
	siteKey: string;
	onToken: (token: string) => void;
	resetSignal?: number;
	action?: string;
};

type TurnstileApi = {
	render: (
		container: HTMLElement,
		options: {
			sitekey: string;
			action?: string;
			callback: (token: string) => void;
			"expired-callback": () => void;
			"error-callback": () => void;
		},
	) => string;
	remove?: (widgetId: string) => void;
	reset?: (widgetId: string) => void;
};

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

let turnstileScriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
	if (window.turnstile) {
		return Promise.resolve();
	}

	if (!turnstileScriptPromise) {
		turnstileScriptPromise = new Promise((resolve, reject) => {
			const existing = document.querySelector<HTMLScriptElement>(
				'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]',
			);
			if (existing) {
				existing.addEventListener("load", () => resolve(), { once: true });
				existing.addEventListener("error", () => reject(new Error("load")), {
					once: true,
				});
				return;
			}

			const script = document.createElement("script");
			script.src =
				"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
			script.async = true;
			script.defer = true;
			script.addEventListener("load", () => resolve(), { once: true });
			script.addEventListener("error", () => reject(new Error("load")), {
				once: true,
			});
			document.head.appendChild(script);
		});
	}

	return turnstileScriptPromise;
}

export function TurnstileWidget({
	siteKey,
	onToken,
	resetSignal = 0,
	action,
}: TurnstileWidgetProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const widgetIdRef = useRef<string | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setFailed(false);

		loadTurnstileScript()
			.then(() => {
				if (cancelled || !containerRef.current || !window.turnstile) {
					return;
				}

				widgetIdRef.current = window.turnstile.render(containerRef.current, {
					sitekey: siteKey,
					action,
					callback: onToken,
					"expired-callback": () => onToken(""),
					"error-callback": () => onToken(""),
				});
			})
			.catch(() => {
				if (!cancelled) {
					setFailed(true);
				}
			});

		return () => {
			cancelled = true;
			if (widgetIdRef.current && window.turnstile?.remove) {
				window.turnstile.remove(widgetIdRef.current);
			}
			widgetIdRef.current = null;
		};
	}, [action, onToken, siteKey]);

	useEffect(() => {
		if (widgetIdRef.current && window.turnstile?.reset) {
			window.turnstile.reset(widgetIdRef.current);
		}
		onToken("");
	}, [onToken, resetSignal]);

	return (
		<div className="turnstile-widget">
			<div ref={containerRef} />
			{failed ? (
				<p className="state-note state-error">
					Turnstile could not be loaded. Please refresh and try again.
				</p>
			) : null}
		</div>
	);
}
