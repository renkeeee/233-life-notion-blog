import { useEffect, useState } from "react";
import { ThemeIcon } from "./ThemeIcon";

export type ThemeMode = "auto" | "light" | "dark";

const themeModes: ThemeMode[] = ["auto", "light", "dark"];
const themeStorageKey = "233-life-theme";

function storedThemeMode(): ThemeMode {
	if (
		typeof window === "undefined" ||
		typeof window.localStorage?.getItem !== "function"
	) {
		return "auto";
	}

	let stored: string | null = null;
	try {
		stored = window.localStorage.getItem(themeStorageKey);
	} catch {
		stored = null;
	}

	return stored === "light" || stored === "dark" || stored === "auto"
		? stored
		: "auto";
}

function applyThemeMode(mode: ThemeMode) {
	if (typeof document === "undefined") {
		return;
	}

	document.documentElement.dataset.theme = mode;
}

export function ThemeModeButton({
	className = "theme-mode-button",
}: {
	className?: string;
}) {
	const [themeMode, setThemeMode] = useState<ThemeMode>(storedThemeMode);

	useEffect(() => {
		applyThemeMode(themeMode);
		if (
			typeof window !== "undefined" &&
			typeof window.localStorage?.setItem === "function"
		) {
			try {
				window.localStorage.setItem(themeStorageKey, themeMode);
			} catch {
				// Theme still applies for the current page even if storage is blocked.
			}
		}
	}, [themeMode]);

	function cycleThemeMode() {
		setThemeMode((current) => {
			const currentIndex = themeModes.indexOf(current);
			return themeModes[(currentIndex + 1) % themeModes.length] ?? "auto";
		});
	}

	return (
		<button
			className={className}
			type="button"
			aria-label={`Theme mode: ${themeMode}`}
			title={`Theme: ${themeMode}`}
			onClick={cycleThemeMode}
		>
			<ThemeIcon mode={themeMode} />
		</button>
	);
}
