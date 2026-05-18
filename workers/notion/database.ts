export function parseNotionDatabaseId(input: string): string {
	const directId = normalizeDatabaseId(input);
	if (directId) {
		return directId;
	}

	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw invalidDatabaseId();
	}

	if (!isNotionHostname(url.hostname)) {
		throw invalidDatabaseId();
	}

	let matches: string[];
	try {
		matches = url.pathname
			.split("/")
			.filter(Boolean)
			.map((segment) => normalizeDatabaseId(decodeURIComponent(segment)))
			.filter((id): id is string => id !== null);
	} catch {
		throw invalidDatabaseId();
	}

	if (matches.length !== 1) {
		throw invalidDatabaseId();
	}

	return matches[0];
}

function normalizeDatabaseId(input: string): string | null {
	if (/^[0-9a-fA-F]{32}$/.test(input)) {
		return input.toLowerCase();
	}

	if (
		/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
			input,
		)
	) {
		return input.replaceAll("-", "").toLowerCase();
	}

	return null;
}

function isNotionHostname(hostname: string): boolean {
	const normalized = hostname.toLowerCase();
	return (
		normalized === "notion.so" ||
		normalized.endsWith(".notion.so") ||
		normalized === "notion.site" ||
		normalized.endsWith(".notion.site")
	);
}

function invalidDatabaseId(): Error {
	return new Error("Invalid Notion database URL or id");
}
