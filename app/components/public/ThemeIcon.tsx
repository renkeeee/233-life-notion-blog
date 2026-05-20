export function ThemeIcon({ mode }: { mode: "auto" | "light" | "dark" }) {
	if (mode === "light") {
		return (
			<svg aria-hidden="true" viewBox="0 0 24 24">
				<circle cx="12" cy="12" r="4" />
				<path d="M12 2v2.4M12 19.6V22M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2 12h2.4M19.6 12H22M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
			</svg>
		);
	}

	if (mode === "dark") {
		return (
			<svg aria-hidden="true" viewBox="0 0 24 24">
				<path d="M20.4 14.6A7.7 7.7 0 0 1 9.4 3.6a8.7 8.7 0 1 0 11 11Z" />
			</svg>
		);
	}

	return (
		<svg aria-hidden="true" viewBox="0 0 24 24">
			<circle cx="12" cy="12" r="8.5" />
			<path d="M12 3.5v17" />
			<path d="M12 5.5a6.5 6.5 0 0 1 0 13" />
		</svg>
	);
}
