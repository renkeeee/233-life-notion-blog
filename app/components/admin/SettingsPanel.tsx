import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { apiGet, apiPost, apiPut } from "../../lib/api-client";

type FieldMapping = {
	title: string;
	status: string;
	publishedAt?: string;
};

export type SiteSettingsForm = {
	siteTitle: string;
	notionDatabaseUrl: string;
	notionDatabaseId: string;
	notionToken: string;
	cdnBaseUrl: string;
	fieldMapping: FieldMapping;
};

type RedactedSettings = SiteSettingsForm & {
	hasNotionToken?: boolean;
};

const emptySettings: SiteSettingsForm = {
	siteTitle: "233 Life",
	notionDatabaseUrl:
		"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
	notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
	notionToken: "",
	cdnBaseUrl: "",
	fieldMapping: {
		title: "Name",
		status: "Status",
		publishedAt: "Published At",
	},
};

const fieldKeys: Array<keyof FieldMapping> = [
	"title",
	"status",
	"publishedAt",
];

export function SettingsPanel({
	csrfToken,
	disabled,
}: {
	csrfToken: string;
	disabled?: boolean;
}) {
	const [settings, setSettings] = useState<SiteSettingsForm>(emptySettings);
	const [status, setStatus] = useState("Loading settings...");
	const [saving, setSaving] = useState(false);
	const [schemaStatus, setSchemaStatus] = useState<string | null>(null);
	const [hasStoredToken, setHasStoredToken] = useState(false);

	useEffect(() => {
		if (disabled) {
			setStatus("Settings are locked until the initial password is changed.");
			return;
		}

		let cancelled = false;
		apiGet<RedactedSettings>("/api/admin/settings")
			.then((response) => {
				if (!cancelled) {
					const hasToken = response.hasNotionToken === true;
					setSettings({
						...response,
						notionToken: hasToken ? "" : response.notionToken,
					});
					setHasStoredToken(hasToken);
					setStatus(
						hasToken
							? "Settings loaded. Re-enter the Notion token when saving changes."
							: "Settings loaded.",
					);
				}
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setStatus(
						error instanceof Error
							? `${error.message}. Save settings to initialize the blog.`
							: "Save settings to initialize the blog.",
					);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [disabled]);

	function update<K extends keyof SiteSettingsForm>(
		key: K,
		value: SiteSettingsForm[K],
	) {
		setSettings((current) => ({ ...current, [key]: value }));
	}

	function updateMapping(key: keyof FieldMapping, value: string) {
		setSettings((current) => ({
			...current,
			fieldMapping: {
				...current.fieldMapping,
				[key]: value,
			},
		}));
	}

	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setStatus("Saving settings...");
		try {
			const saved = await apiPut<RedactedSettings>(
				"/api/admin/settings",
				settings,
				csrfToken,
			);
			const hasToken = saved.hasNotionToken === true;
			setSettings({
				...saved,
				notionToken: hasToken ? settings.notionToken : saved.notionToken,
			});
			setHasStoredToken(hasToken);
			setStatus("Settings saved.");
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Settings could not be saved.");
		} finally {
			setSaving(false);
		}
	}

	async function testSchema() {
		setSchemaStatus("Testing Notion schema...");
		try {
			const response = await apiPost<Record<string, unknown>>(
				"/api/admin/notion/schema",
				{
					notionDatabaseUrl: settings.notionDatabaseUrl,
					notionDatabaseId: settings.notionDatabaseId,
					notionToken: settings.notionToken,
					fieldMapping: settings.fieldMapping,
				},
				csrfToken,
			);
			setSchemaStatus(JSON.stringify(response, null, 2));
		} catch (error) {
			setSchemaStatus(
				error instanceof Error
					? `${error.message}. Schema testing endpoint is not available yet.`
					: "Schema testing endpoint is not available yet.",
			);
		}
	}

	return (
		<div className="admin-stack">
			<div className="admin-section-heading">
				<h2>Data source settings</h2>
				<button type="button" onClick={testSchema} disabled={disabled}>
					Test schema
				</button>
			</div>
			{disabled ? (
				<p className="admin-warning">
					Change the initial password before editing data source settings.
				</p>
			) : null}
			<form className="admin-form" onSubmit={save}>
				<label>
					Site title
					<input
						value={settings.siteTitle}
						onChange={(event) => update("siteTitle", event.currentTarget.value)}
						disabled={disabled}
					/>
				</label>
				<label>
					Notion database URL
					<input
						value={settings.notionDatabaseUrl}
						onChange={(event) => update("notionDatabaseUrl", event.currentTarget.value)}
						disabled={disabled}
					/>
				</label>
				<label>
					Notion database ID
					<input
						value={settings.notionDatabaseId}
						onChange={(event) => update("notionDatabaseId", event.currentTarget.value)}
						disabled={disabled}
					/>
				</label>
				<label>
					Notion token
					<input
						type="password"
						value={settings.notionToken}
						onChange={(event) => update("notionToken", event.currentTarget.value)}
						placeholder={
							hasStoredToken
								? "Stored token exists; re-enter before saving"
								: "secret_xxx"
						}
						disabled={disabled}
					/>
				</label>
				<label>
					CDN base URL
					<input
						value={settings.cdnBaseUrl}
						onChange={(event) => update("cdnBaseUrl", event.currentTarget.value)}
						disabled={disabled}
					/>
				</label>
				<div className="admin-field-grid">
					{fieldKeys.map((key) => (
						<label key={key}>
							{key}
							<input
								value={settings.fieldMapping[key] ?? ""}
								onChange={(event) => updateMapping(key, event.currentTarget.value)}
								disabled={disabled}
							/>
						</label>
					))}
				</div>
				<p className="admin-note">{status}</p>
				{schemaStatus ? <pre className="admin-code">{schemaStatus}</pre> : null}
				<button type="submit" disabled={saving || disabled}>
					{saving ? "Saving..." : "Save settings"}
				</button>
			</form>
		</div>
	);
}
