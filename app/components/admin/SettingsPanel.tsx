import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { apiGet, apiPost, apiPut } from "../../lib/api-client";

type FieldMapping = {
	title: string;
	status: string;
	category?: string;
	tags?: string;
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

type NotionSchemaOption = {
	name?: unknown;
};

type NotionSchemaProperty = {
	type?: string;
	status?: { options?: NotionSchemaOption[] };
	select?: { options?: NotionSchemaOption[] };
	[key: string]: unknown;
};

type NotionSchemaResponse = {
	databaseId?: string;
	properties?: Record<string, NotionSchemaProperty>;
	recommendedFieldMapping?: Partial<FieldMapping>;
};

const defaultPublishedStatusValues = ["Published", "已发布"];

const emptySettings: SiteSettingsForm = {
	siteTitle: "233.life",
	notionDatabaseUrl:
		"https://www.notion.so/renke-me/233-life-3646b3023c2380fc886af37685393dd4?source=copy_link",
	notionDatabaseId: "3646b3023c2380fc886af37685393dd4",
	notionToken: "",
	cdnBaseUrl: "",
	fieldMapping: {
		title: "Name",
		status: "Status",
		category: "Category",
		tags: "Tags",
		publishedAt: "Published At",
		publishedStatusValues: defaultPublishedStatusValues,
	},
};

type FieldNameKey = "title" | "status" | "category" | "tags" | "publishedAt";

const fieldKeys: Array<{
	key: FieldNameKey;
	typeDescription: string;
	allowedTypes: string[];
	optional?: boolean;
}> = [
	{ key: "title", typeDescription: "Notion type: title", allowedTypes: ["title"] },
	{
		key: "status",
		typeDescription: "Notion type: status, select, or checkbox",
		allowedTypes: ["status", "select", "checkbox"],
	},
	{
		key: "category",
		typeDescription: "Notion type: select, status, title, or rich_text",
		allowedTypes: ["select", "status", "title", "rich_text"],
		optional: true,
	},
	{
		key: "tags",
		typeDescription: "Notion type: multi_select or select",
		allowedTypes: ["multi_select", "select"],
		optional: true,
	},
	{
		key: "publishedAt",
		typeDescription: "Notion type: date or created_time",
		allowedTypes: ["date", "created_time"],
		optional: true,
	},
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

function normalizeSettings(settings: RedactedSettings): SiteSettingsForm {
	return {
		siteTitle: settings.siteTitle,
		notionDatabaseUrl: settings.notionDatabaseUrl,
		notionDatabaseId: settings.notionDatabaseId,
		notionToken: settings.notionToken,
		cdnBaseUrl: settings.cdnBaseUrl,
		fieldMapping: {
			...settings.fieldMapping,
			category:
				settings.fieldMapping.category ?? emptySettings.fieldMapping.category,
			tags: settings.fieldMapping.tags ?? emptySettings.fieldMapping.tags,
			publishedStatusValues:
				settings.fieldMapping.publishedStatusValues &&
				settings.fieldMapping.publishedStatusValues.length > 0
					? settings.fieldMapping.publishedStatusValues
					: defaultPublishedStatusValues,
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSchemaProperties(
	properties: unknown,
): Record<string, NotionSchemaProperty> | null {
	if (!isRecord(properties)) {
		return null;
	}

	const validProperties: Record<string, NotionSchemaProperty> = {};
	for (const [name, property] of Object.entries(properties)) {
		if (isRecord(property)) {
			validProperties[name] = property as NotionSchemaProperty;
		}
	}

	return validProperties;
}

function schemaFieldOptions(
	properties: Record<string, NotionSchemaProperty>,
	field: (typeof fieldKeys)[number],
	currentValue: string,
): Array<{ name: string; label: string }> {
	const options = Object.entries(properties)
		.filter(([, property]) => field.allowedTypes.includes(property.type ?? ""))
		.map(([name, property]) => ({
			name,
			label: `${name} (${property.type ?? "unknown"})`,
		}));

	if (field.optional) {
		options.unshift({
			name: "",
			label:
				field.key === "publishedAt"
					? "Use Notion page created time"
					: "Do not map this field",
		});
	}

	if (
		currentValue &&
		!options.some((option) => option.name === currentValue)
	) {
		options.push({
			name: currentValue,
			label: `${currentValue} (not in loaded schema)`,
		});
	}

	if (options.length === 0) {
		return [{ name: "", label: "No compatible fields found" }];
	}

	return options;
}

function optionNames(options: unknown): string[] {
	if (!Array.isArray(options)) {
		return [];
	}

	return Array.from(
		new Set(
			options
				.map((option) =>
					isRecord(option) && typeof option.name === "string"
						? option.name.trim()
						: "",
				)
				.filter(Boolean),
		),
	);
}

function propertyEnumValues(property: NotionSchemaProperty | undefined): string[] {
	if (!property) {
		return [];
	}

	if (property.type === "status") {
		return optionNames(property.status?.options);
	}

	if (property.type === "select") {
		return optionNames(property.select?.options);
	}

	return [];
}

export function SettingsPanel({
	csrfToken,
	disabled,
	headingId,
}: {
	csrfToken: string;
	disabled?: boolean;
	headingId?: string;
}) {
	const [settings, setSettings] = useState<SiteSettingsForm>(emptySettings);
	const [status, setStatus] = useState("Loading settings...");
	const [saving, setSaving] = useState(false);
	const [schemaStatus, setSchemaStatus] = useState<string | null>(null);
	const [schemaProperties, setSchemaProperties] =
		useState<Record<string, NotionSchemaProperty> | null>(null);
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

	function addPublishedStatusValue(value: string) {
		setPublishedStatusText((current) =>
			publishedStatusValuesText([...parsePublishedStatusValues(current), value]),
		);
	}

	function settingsForRequest(): SiteSettingsForm {
		return {
			siteTitle: settings.siteTitle,
			notionDatabaseUrl: settings.notionDatabaseUrl,
			notionDatabaseId: settings.notionDatabaseId,
			notionToken: settings.notionToken,
			cdnBaseUrl: settings.cdnBaseUrl,
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

	function validateSettingsForSave(): string | null {
		if (!hasStoredToken && settings.notionToken.trim().length === 0) {
			return "Notion token is required.";
		}

		if (settings.cdnBaseUrl.trim().length === 0) {
			return "CDN base URL is required.";
		}

		return null;
	}

	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const validationError = validateSettingsForSave();

		if (validationError) {
			setStatus(validationError);
			return;
		}

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
			const response = await apiPost<NotionSchemaResponse>(
				"/api/admin/notion/schema",
				schemaRequestBody(),
				csrfToken,
			);
			const properties = validSchemaProperties(response.properties);
			setSchemaProperties(properties);
			if (response.recommendedFieldMapping) {
				const recommended = response.recommendedFieldMapping;
				setSettings((current) => ({
					...current,
					fieldMapping: {
						...current.fieldMapping,
						...(typeof recommended.title === "string" && recommended.title
							? { title: recommended.title }
							: {}),
						...(typeof recommended.status === "string" && recommended.status
							? { status: recommended.status }
							: {}),
						...(typeof recommended.category === "string"
							? { category: recommended.category }
							: {}),
						...(typeof recommended.tags === "string"
							? { tags: recommended.tags }
							: {}),
						...(typeof recommended.publishedAt === "string"
							? { publishedAt: recommended.publishedAt }
							: {}),
						...(Array.isArray(recommended.publishedStatusValues)
							? {
									publishedStatusValues:
										recommended.publishedStatusValues.filter(
											(value): value is string =>
												typeof value === "string" && value.trim().length > 0,
										),
								}
							: {}),
					},
				}));
				if (
					Array.isArray(recommended.publishedStatusValues) &&
					recommended.publishedStatusValues.length > 0
				) {
					setPublishedStatusText(
						publishedStatusValuesText(
							recommended.publishedStatusValues.filter(
								(value): value is string =>
									typeof value === "string" && value.trim().length > 0,
							),
						),
					);
				}
			}
			setSchemaStatus("Schema loaded. Field choices were updated from Notion.");
		} catch (error) {
			setSchemaProperties(null);
			setSchemaStatus(
				error instanceof Error
					? error.message
					: "Notion schema could not be loaded.",
			);
		}
	}

	const selectedStatusProperty = schemaProperties
		? schemaProperties[settings.fieldMapping.status]
		: undefined;
	const selectedStatusEnumValues = propertyEnumValues(selectedStatusProperty);

	return (
		<div className="admin-stack">
			<div className="admin-section-heading">
				<h2 id={headingId}>Data source settings</h2>
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
					{fieldKeys.map((field) => (
						<label className="admin-field-card" key={field.key}>
							<span>{field.key}</span>
							<span className="admin-help">{field.typeDescription}</span>
							{schemaProperties ? (
								<select
									aria-label={field.key}
									value={settings.fieldMapping[field.key] ?? ""}
									onChange={(event) =>
										updateMapping(field.key, event.currentTarget.value)
									}
									disabled={disabled}
								>
									{schemaFieldOptions(
										schemaProperties,
										field,
										settings.fieldMapping[field.key] ?? "",
									).map((option) => (
										<option key={`${field.key}:${option.name}`} value={option.name}>
											{option.label}
										</option>
									))}
								</select>
							) : (
								<input
									aria-label={field.key}
									value={settings.fieldMapping[field.key] ?? ""}
									onChange={(event) =>
										updateMapping(field.key, event.currentTarget.value)
									}
									disabled={disabled}
								/>
							)}
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
					{schemaProperties ? (
						<div className="admin-schema-options" aria-label="Status enum values">
							{selectedStatusProperty?.type === "checkbox" ? (
								<span className="admin-help">
									Selected checkbox fields publish when checked.
								</span>
							) : selectedStatusEnumValues.length > 0 ? (
								<>
									<span className="admin-help">
										Options from {settings.fieldMapping.status}
									</span>
									<div className="admin-schema-option-buttons">
										{selectedStatusEnumValues.map((value) => (
											<button
												type="button"
												className="admin-secondary-button"
												key={value}
												onClick={() => addPublishedStatusValue(value)}
												disabled={disabled}
											>
												Add {value}
											</button>
										))}
									</div>
								</>
							) : (
								<span className="admin-help">
									The selected status field did not return enum values.
								</span>
							)}
						</div>
					) : null}
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
