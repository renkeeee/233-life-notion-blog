export function parseNotionDatabaseId(input: string): string {
	const compact = input.replaceAll("-", "");
	const match = compact.match(/[0-9a-fA-F]{32}/);
	if (!match) {
		throw new Error("Invalid Notion database URL or id");
	}
	return match[0].toLowerCase();
}
