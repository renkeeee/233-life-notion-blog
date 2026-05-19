import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { apiGet, apiPost, apiPut } from "../../lib/api-client";

type FieldMapping = {
	title: string;
	status: string;
	publishedAt?: string;
	publishedStatusValues?: string[];
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

const defaultPublishedStatusValues = ["Published", "已发布"];

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
		publishedStatusValues: defaultPublishedStatusValues,
	},
};

type FieldNameKey = "title" | "status" | "publishedAt";

const fieldKeys: Array<{
	key: FieldNameKey;
	typeDescription: string;
}> = [
	{ key: "title", typeDescription: "Notion type: title" },
	{ key: "status", typeDescription: "Notion type: status, select, or checkbox" },
	{ key: "publishedAt", typeDescription: "Notion type: date or created_time" },
];

function publishedStatusValuesText(values: string[] | undefined): string {
	return (values && values.length > 0 ? values : defaultPublishedStatusValues).join(
		"\n",
	);
}

function parsePublishedStatusValues(text: string): string[] {
	return Array.from(
		new Set(
			text
				.split(/[\n,]/g)
				.map((value) => value.trim())
				.filter(Boolean),
		),
	);
}

function normalizeSettings(settings: RedactedSettings): RedactedSettings {
	return {
		...settings,
		fieldMapping: {
			...settings.fieldMapping,
			publishedStatusValues:
				settings.fieldMapping.publishedStatusValues &&
				settings.fieldMapping.publishedStatusValues.length > 0
					? settings.fieldMapping.publishedStatusValues
					: defaultPublishedStatusValues,
		},
	};
}

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
	const [publishedStatusText, setPublishedStatusText] = useState(
		publishedStatusValuesText(emptySettings.fieldMapping.publishedStatusValues),
	);

	useEffect(() => {
		if (disabled) {
			setStatus("Settings are locked until the initial password is changed.");
			return;
		}

		let cancelled = false;
		apiGet<RedactedSettings>("/api/admin/settings")
			.then((response) => {
				if (!cancelled) {
					const normalizedResponse = normalizeSettings(response);
					const hasToken = response.hasNotionToken === true;
					setSettings({
						...normalizedResponse,
						notionToken: hasToken ? "" : normalizedResponse.notionToken,
					});
					setPublishedStatusText(
						publishedStatusValuesText(
							normalizedResponse.fieldMapping.publishedStatusValues,
						),
					);
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

	function updateMapping(key: FieldNameKey, value: string) {
		setSettings((current) => ({
			...current,
			fieldMapping: {
				...current.fieldMapping,
				[key]: value,
			},
		}));
	}

	function settingsForRequest(): SiteSettingsForm {
		return {
			...settings,
			fieldMapping: {
				...settings.fieldMapping,
				publishedStatusValues: parsePublishedStatusValues(publishedStatusText),
			},
		};
	}

	function schemaRequestBody(): Record<string, unknown> {
		const token = settings.notionToken.trim();

		return {
			notionDatabaseUrl: settings.notionDatabaseUrl,
			notionDatabaseId: settings.notionDatabaseId,
			...(token ? { notionToken: token } : {}),
			fieldMapping: settingsForRequest().fieldMapping,
		};
	}

	function settingsSaveBody(): Record<string, unknown> {
		const payload = settingsForRequest();
		const token = payload.notionToken.trim();

		if (!token && hasStoredToken) {
			const { notionToken: _notionToken, ...body } = payload;
			return body;
		}

		return {
			...payload,
			notionToken: token,
		};
	}

	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setStatus("Saving settings...");
		try {
			const payload = settingsSaveBody();
			const saved = await apiPut<RedactedSettings>(
				"/api/admin/settings",
				payload,
				csrfToken,
			);
			const normalizedSaved = normalizeSettings(saved);
			const hasToken = saved.hasNotionToken === true;
			const submittedToken =
				typeof payload.notionToken === "string" ? payload.notionToken : "";
			setSettings({
				...normalizedSaved,
				notionToken: hasToken ? submittedToken : normalizedSaved.notionToken,
			});
			setPublishedStatusText(
				publishedStatusValuesText(
					normalizedSaved.fieldMapping.publishedStatusValues,
				),
			);
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
				schemaRequestBody(),
				csrfToken,
			);
			setSchemaStatus(JSON.stringify(response, null, 2));
		} catch (error) {
			setSchemaStatus(
				error instanceof Error
					? error.message
					: "Notion schema could not be loaded.",
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
					{fieldKeys.map(({ key, typeDescription }) => (
						<label className="admin-field-card" key={key}>
							<span>{key}</span>
							<span className="admin-help">{typeDescription}</span>
							<input
								aria-label={key}
								value={settings.fieldMapping[key] ?? ""}
								onChange={(event) => updateMapping(key, event.currentTarget.value)}
								disabled={disabled}
							/>
						</label>
					))}
					<label className="admin-field-card wide">
						<span>Published status values</span>
						<span className="admin-help">
							One value per line. Matching status/select values are public;
							checkbox true is public.
						</span>
						<textarea
							aria-label="Published status values"
							value={publishedStatusText}
							onChange={(event) =>
								setPublishedStatusText(event.currentTarget.value)
							}
							disabled={disabled}
							rows={3}
						/>
					</label>
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
