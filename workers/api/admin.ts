import { errorJson, json, readJsonObject } from "../http";
import {
	createSessionToken,
	initialAdminPassword,
	shouldBootstrapPassword,
	verifySessionToken,
	type AdminSession,
} from "../auth";
import { parseCookies, serializeCookie } from "../cookies";
import {
	decryptString,
	encryptString,
	hashPassword,
	randomToken,
	verifyPassword,
} from "../crypto";
import { SettingsRepository } from "../db/d1";
import {
	loadCommentsDefaultEnabled,
	loadCommentsGlobalEnabled,
	saveCommentsDefaultEnabled,
	saveCommentsGlobalEnabled,
} from "../comments";
import {
	parseSettingsFromRows,
	redactSettings,
	serializeSettingsForStorage,
	type SettingRow,
} from "../settings";
import { runSync as defaultRunSync, type RunSyncInput } from "../sync";
import type { AppEnv, SiteSettings } from "../types";
import { NotionApiError, NotionClient } from "../notion/client";
import {
	inferFieldMapping,
	parseNotionDatabaseId,
	type NotionProperties,
} from "../notion/database";

type LoginBody = {
	password: string;
};

type PasswordChangeBody = {
	currentPassword: string;
	newPassword: string;
};

type ManualSyncBody = {
	rangeStart: string | null;
	rangeEnd: string | null;
	force: boolean;
};

type CommentsEnabledBody = {
	enabled: boolean;
};

type CommentSettingsBody = {
	defaultEnabled?: boolean;
	globalEnabled?: boolean;
};

type SyncRunRow = {
	id: string;
	trigger_type: "cron" | "manual";
	started_at: string;
	finished_at: string | null;
	status: "running" | "success" | "partial" | "failed";
	range_start: string | null;
	range_end: string | null;
	force: number;
	created_count: number;
	updated_count: number;
	metadata_only_count: number;
	skipped_count: number;
	unpublished_count: number;
	archived_count: number;
	failed_count: number;
	error_code: string | null;
	error_message: string | null;
};

type AdminPostRow = {
	id: string;
	title: string;
	slug: string;
	status: string;
	visibility: "published" | "hidden" | "archived";
	manual_visibility: "visible" | "hidden";
	locked: number;
	comments_enabled: number;
	lock_password_encrypted: string | null;
	published_at: string | null;
	notion_last_edited_time: string;
	updated_at: string;
	last_sync_error: string | null;
};

type AdminPostAction =
	| "hide"
	| "restore"
	| "lock"
	| "unlock"
	| "comments-on"
	| "comments-off"
	| "delete";

type AdminPostIdentityRow = {
	id: string;
	notion_page_id: string;
	slug: string;
	title: string;
};

type AdminPostCommentParentRow = {
	id: string;
	title: string;
	comments_enabled: number;
};

type AdminPostCommentRow = {
	id: string;
	nickname: string;
	body: string;
	created_at: string;
};

type NotionSchemaBody = {
	notionDatabaseId: string;
	notionToken?: string;
	dataSourceId?: string;
};

type ResolvedNotionSchemaBody = NotionSchemaBody & {
	notionToken: string;
};

type AdminApiOptions = {
	runSync?: (
		env: AppEnv,
		input: RunSyncInput,
	) => Promise<{ runId: string }>;
};

const adminPasswordHashKey = "adminPasswordHash";
const adminSessionCookie = "admin_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;
const minChangedPasswordLength = 8;
const maxPasswordLength = 1024;
const passwordHashPattern =
	/^pbkdf2-sha256:([1-9]\d*):[^:]+:[0-9a-fA-F]{64}$/;
const isoDateTimePattern =
	/^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const minPasswordHashIterations = 100_000;
const maxPasswordHashIterations = 1_000_000;

export function validateLoginBody(body: Record<string, unknown>): LoginBody {
	if (typeof body.password !== "string" || body.password.length === 0) {
		throw new Error("Password is required");
	}

	if (body.password.length > maxPasswordLength) {
		throw new Error(`Password must be at most ${maxPasswordLength} characters`);
	}

	return { password: body.password };
}

function validatePasswordChangeBody(
	body: Record<string, unknown>,
): PasswordChangeBody {
	if (
		typeof body.currentPassword !== "string" ||
		body.currentPassword.length === 0
	) {
		throw new Error("Current password is required");
	}

	if (typeof body.newPassword !== "string" || body.newPassword.length === 0) {
		throw new Error("New password is required");
	}

	if (body.currentPassword.length > maxPasswordLength) {
		throw new Error(
			`Current password must be at most ${maxPasswordLength} characters`,
		);
	}

	if (body.newPassword === initialAdminPassword) {
		throw new Error("New password cannot be the initial password");
	}

	if (body.newPassword.length < minChangedPasswordLength) {
		throw new Error(
			`New password must be at least ${minChangedPasswordLength} characters`,
		);
	}

	if (body.newPassword.length > maxPasswordLength) {
		throw new Error(
			`New password must be at most ${maxPasswordLength} characters`,
		);
	}

	return {
		currentPassword: body.currentPassword,
		newPassword: body.newPassword,
	};
}

function validateManualSyncBody(body: Record<string, unknown>): ManualSyncBody {
	const rangeStart = requiredOptionalDateString(body, "rangeStart");
	const rangeEnd = requiredOptionalDateString(body, "rangeEnd");
	const force = body.force;

	if (typeof force !== "boolean") {
		throw new Error("force must be a boolean");
	}

	if (
		rangeStart !== null &&
		rangeEnd !== null &&
		Date.parse(rangeStart) > Date.parse(rangeEnd)
	) {
		throw new Error("rangeStart must be before or equal to rangeEnd");
	}

	return {
		rangeStart,
		rangeEnd,
		force,
	};
}

function validateCommentsEnabledBody(
	body: Record<string, unknown>,
): CommentsEnabledBody {
	if (typeof body.enabled !== "boolean") {
		throw new Error("enabled must be a boolean");
	}

	return { enabled: body.enabled };
}

function validateCommentSettingsBody(
	body: Record<string, unknown>,
): CommentSettingsBody {
	if (
		body.enabled !== undefined &&
		body.defaultEnabled !== undefined &&
		body.enabled !== body.defaultEnabled
	) {
		throw new Error("enabled and defaultEnabled must match when both are set");
	}

	if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
		throw new Error("enabled must be a boolean");
	}

	if (
		body.defaultEnabled !== undefined &&
		typeof body.defaultEnabled !== "boolean"
	) {
		throw new Error("defaultEnabled must be a boolean");
	}

	if (
		body.globalEnabled !== undefined &&
		typeof body.globalEnabled !== "boolean"
	) {
		throw new Error("globalEnabled must be a boolean");
	}

	const defaultEnabled =
		typeof body.defaultEnabled === "boolean"
			? body.defaultEnabled
			: typeof body.enabled === "boolean"
				? body.enabled
				: undefined;
	const globalEnabled =
		typeof body.globalEnabled === "boolean" ? body.globalEnabled : undefined;

	if (defaultEnabled === undefined && globalEnabled === undefined) {
		throw new Error("At least one comment setting is required");
	}

	return {
		...(defaultEnabled !== undefined ? { defaultEnabled } : {}),
		...(globalEnabled !== undefined ? { globalEnabled } : {}),
	};
}

function validateNotionSchemaBody(
	body: Record<string, unknown>,
): NotionSchemaBody {
	const notionToken = body.notionToken;
	let validNotionToken: string | undefined;

	if (notionToken !== undefined) {
		if (typeof notionToken !== "string") {
			throw new Error("Notion token must be a string");
		}

		if (notionToken.length > maxPasswordLength) {
			throw new Error(`Notion token must be at most ${maxPasswordLength} characters`);
		}

		if (notionToken.length > 0) {
			validNotionToken = notionToken;
		}
	}

	const notionDatabaseId =
		typeof body.notionDatabaseId === "string" && body.notionDatabaseId.length > 0
			? parseNotionDatabaseId(body.notionDatabaseId)
			: typeof body.notionDatabaseUrl === "string" &&
				  body.notionDatabaseUrl.length > 0
				? parseNotionDatabaseId(body.notionDatabaseUrl)
				: null;

	if (!notionDatabaseId) {
		throw new Error("Notion database URL or id is required");
	}

	const dataSourceId = body.dataSourceId;

	if (dataSourceId !== undefined) {
		if (typeof dataSourceId !== "string" || dataSourceId.length === 0) {
			throw new Error("dataSourceId must be a non-empty string");
		}

		return { notionDatabaseId, notionToken: validNotionToken, dataSourceId };
	}

	return { notionDatabaseId, notionToken: validNotionToken };
}

function requiredOptionalDateString(
	body: Record<string, unknown>,
	name: "rangeStart" | "rangeEnd",
): string | null {
	if (!Object.hasOwn(body, name)) {
		throw new Error(`${name} must be an ISO date string or null`);
	}

	const value = body[name];

	if (value === null) {
		return null;
	}

	if (typeof value !== "string" || !isValidIsoDateString(value)) {
		throw new Error(`${name} must be an ISO date string or null`);
	}

	return value;
}

function isValidIsoDateString(value: string): boolean {
	const match = isoDateTimePattern.exec(value);
	if (!match) {
		return false;
	}

	const timestamp = Date.parse(value);
	if (Number.isNaN(timestamp)) {
		return false;
	}

	const [, year, month, day] = match;

	return isValidCalendarDate(Number(year), Number(month), Number(day));
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
	if (month < 1 || month > 12 || day < 1) {
		return false;
	}

	return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function adminNotFound(): Response {
	return errorJson("NOT_FOUND", "Admin API route not found", 404);
}

function unauthorized(): Response {
	return errorJson("UNAUTHORIZED", "Authentication required", 401);
}

function invalidCredentials(): Response {
	return errorJson("UNAUTHORIZED", "Invalid credentials", 401);
}

function invalidCsrf(): Response {
	return errorJson("FORBIDDEN", "Invalid CSRF token", 403);
}

function passwordChangeRequired(): Response {
	return errorJson("FORBIDDEN", "Password change required", 403);
}

function sessionCookie(value: string, maxAge: number): string {
	return serializeCookie(adminSessionCookie, value, {
		httpOnly: true,
		maxAge,
		path: "/",
		sameSite: "Lax",
		secure: true,
	});
}

async function currentSession(
	request: Request,
	rootKey: string,
): Promise<AdminSession | null> {
	const token = parseCookies(request.headers.get("cookie"))[adminSessionCookie];

	if (!token) {
		return null;
	}

	try {
		return await verifySessionToken(token, rootKey);
	} catch {
		return null;
	}
}

async function requireSession(
	request: Request,
	rootKey: string,
): Promise<AdminSession | Response> {
	const session = await currentSession(request, rootKey);

	return session ?? unauthorized();
}

function hasUsablePasswordHash(storedHash: string | null): storedHash is string {
	if (storedHash === null) {
		return false;
	}

	const match = passwordHashPattern.exec(storedHash);

	if (!match) {
		return false;
	}

	const iterations = Number(match[1]);

	return (
		Number.isSafeInteger(iterations) &&
		iterations >= minPasswordHashIterations &&
		iterations <= maxPasswordHashIterations
	);
}

async function adminPasswordMustChange(
	repository: SettingsRepository,
): Promise<boolean> {
	const storedHash = (await repository.get(adminPasswordHashKey))?.value ?? null;

	return (
		hasUsablePasswordHash(storedHash) &&
		(await verifyPassword(initialAdminPassword, storedHash))
	);
}

async function requireUsableAdminSession(
	request: Request,
	env: AppEnv,
): Promise<AdminSession | Response> {
	const session = await requireSession(request, env.CONFIG_ENCRYPTION_KEY);

	if (session instanceof Response) {
		return session;
	}

	const repository = new SettingsRepository(env.DB);
	const storedHash = (await repository.get(adminPasswordHashKey))?.value ?? null;

	if (!hasUsablePasswordHash(storedHash)) {
		return unauthorized();
	}

	if (await verifyPassword(initialAdminPassword, storedHash)) {
		return passwordChangeRequired();
	}

	return session;
}

function requireCsrf(request: Request, session: AdminSession): Response | null {
	if (request.headers.get("x-csrf-token") !== session.csrfToken) {
		return invalidCsrf();
	}

	return null;
}

async function authenticatePassword(
	password: string,
	repository: SettingsRepository,
): Promise<{ authenticated: boolean; mustChangePassword: boolean }> {
	const storedHash = (await repository.get(adminPasswordHashKey))?.value ?? null;

	if (shouldBootstrapPassword(storedHash)) {
		if (password !== initialAdminPassword) {
			return { authenticated: false, mustChangePassword: false };
		}

		await repository.put({
			key: adminPasswordHashKey,
			value: await hashPassword(initialAdminPassword),
			encrypted: 0,
			updated_at: new Date().toISOString(),
		});
		return { authenticated: true, mustChangePassword: true };
	}

	if (storedHash === null) {
		return { authenticated: false, mustChangePassword: false };
	}

	const authenticated = await verifyPassword(password, storedHash);

	return {
		authenticated,
		mustChangePassword:
			authenticated && (await verifyPassword(initialAdminPassword, storedHash)),
	};
}

async function handleLogin(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	let body: Record<string, unknown>;
	let loginBody: LoginBody;

	try {
		body = await readJsonObject(request);
		loginBody = validateLoginBody(body);
	} catch (error) {
		const message =
			error instanceof Error &&
			(error.message === "Password is required" ||
				error.message ===
					`Password must be at most ${maxPasswordLength} characters`)
				? error.message
				: "Invalid request body";
		return errorJson("BAD_REQUEST", message, 400);
	}

	const repository = new SettingsRepository(env.DB);
	const authResult = await authenticatePassword(loginBody.password, repository);

	if (!authResult.authenticated) {
		return invalidCredentials();
	}

	const csrfToken = randomToken(24);
	const token = await createSessionToken(
		env.CONFIG_ENCRYPTION_KEY,
		csrfToken,
	);

	return json(
		{
			authenticated: true,
			csrfToken,
			...(authResult.mustChangePassword ? { mustChangePassword: true } : {}),
		},
		200,
		new Headers({
			"set-cookie": sessionCookie(token, sessionMaxAgeSeconds),
		}),
	);
}

async function handlePasswordChange(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireSession(request, env.CONFIG_ENCRYPTION_KEY);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);

	if (csrfError) {
		return csrfError;
	}

	let body: PasswordChangeBody;

	try {
		body = validatePasswordChangeBody(await readJsonObject(request));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Invalid request body";

		return errorJson("BAD_REQUEST", message, 400);
	}

	const repository = new SettingsRepository(env.DB);
	const storedHash = (await repository.get(adminPasswordHashKey))?.value ?? null;

	if (storedHash === null) {
		return invalidCredentials();
	}

	if (!(await verifyPassword(body.currentPassword, storedHash))) {
		return invalidCredentials();
	}

	await repository.put({
		key: adminPasswordHashKey,
		value: await hashPassword(body.newPassword),
		encrypted: 0,
		updated_at: new Date().toISOString(),
	});

	return json({ ok: true });
}

async function handleMe(request: Request, env: AppEnv): Promise<Response> {
	const session = await currentSession(request, env.CONFIG_ENCRYPTION_KEY);

	if (!session) {
		return json({ authenticated: false });
	}

	const repository = new SettingsRepository(env.DB);
	const mustChangePassword = await adminPasswordMustChange(repository);

	return json({
		authenticated: true,
		csrfToken: session.csrfToken,
		...(mustChangePassword ? { mustChangePassword: true } : {}),
	});
}

async function handleLogout(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireSession(request, env.CONFIG_ENCRYPTION_KEY);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);

	if (csrfError) {
		return csrfError;
	}

	return json(
		{ authenticated: false },
		200,
		new Headers({
			"set-cookie": sessionCookie("", 0),
		}),
	);
}

function isMissingSettingsError(error: unknown): boolean {
	return error instanceof Error && error.message.startsWith("Missing setting:");
}

function isSettingsValidationError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.message.startsWith("Invalid setting:") ||
			error.message.startsWith("Missing setting:") ||
			error.message.startsWith("Unknown setting key:"))
	);
}

function settingsValidationMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Invalid settings";
}

function configDecryptError(): Response {
	return errorJson(
		"CONFIG_DECRYPT_FAILED",
		"Stored settings could not be decrypted",
		500,
	);
}

function settingsSaveError(): Response {
	return errorJson("INTERNAL_ERROR", "Settings could not be saved", 500);
}

function settingsLoadError(): Response {
	return errorJson("INTERNAL_ERROR", "Settings could not be loaded", 500);
}

function notionSchemaError(error: unknown): Response {
	if (error instanceof NotionApiError) {
		if (error.status === 401 || error.status === 403) {
			return errorJson(
				"NOTION_AUTH_FAILED",
				"Notion authentication failed",
				401,
			);
		}

		if (error.status === 404) {
			return errorJson(
				"NOTION_DATABASE_NOT_FOUND",
				"Notion database not found",
				404,
			);
		}

		if (error.status === 429) {
			return errorJson("NOTION_RATE_LIMITED", "Notion API rate limited", 429);
		}

		if (error.status === 400) {
			return errorJson(
				"BAD_REQUEST",
				`Notion schema could not be loaded: ${error.message}`,
				400,
			);
		}

		return errorJson(
			"INTERNAL_ERROR",
			`Notion schema could not be loaded: ${error.message}`,
			500,
		);
	}

	if (
		error instanceof Error &&
		(error.message.startsWith("FIELD_MAPPING_INVALID") ||
			error.message.startsWith("NOTION_DATABASE_AMBIGUOUS") ||
			error.message.startsWith("NOTION_DATA_SOURCE_AMBIGUOUS"))
	) {
		return errorJson(
			"FIELD_MAPPING_INVALID",
			"Notion schema does not match the required blog fields",
			400,
		);
	}

	return errorJson(
		"INTERNAL_ERROR",
		`Notion schema could not be loaded: ${safeErrorMessage(error)}`,
		500,
	);
}

function safeErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.length > 0) {
		return error.message;
	}

	if (typeof error === "string" && error.length > 0) {
		return error;
	}

	return "Unknown error";
}

function siteSettingRows(rows: SettingRow[]): SettingRow[] {
	return rows.filter((row) => row.key !== adminPasswordHashKey);
}

async function handleGetSettings(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const repository = new SettingsRepository(env.DB);
	let rows: SettingRow[];

	try {
		rows = await repository.list();
	} catch {
		return settingsLoadError();
	}

	try {
		const settings = await parseSettingsFromRows(
			siteSettingRows(rows),
			env.CONFIG_ENCRYPTION_KEY,
		);

		return json(redactSettings(settings));
	} catch (error) {
		if (isMissingSettingsError(error)) {
			return errorJson("NOT_FOUND", "Settings not found", 404);
		}

		return configDecryptError();
	}
}

async function handlePutSettings(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);

	if (csrfError) {
		return csrfError;
	}

	let body: Record<string, unknown>;

	try {
		body = await readJsonObject(request);
	} catch {
		return errorJson("BAD_REQUEST", "Invalid request body", 400);
	}

	const settingsBody = await resolveSettingsSaveToken(body, env);
	if (settingsBody instanceof Response) {
		return settingsBody;
	}

	const settings = settingsBody as unknown as SiteSettings;
	let rows: SettingRow[];
	let parsedSettings: SiteSettings;

	try {
		rows = await serializeSettingsForStorage(
			settings,
			env.CONFIG_ENCRYPTION_KEY,
		);
	} catch (error) {
		if (isSettingsValidationError(error)) {
			return errorJson("BAD_REQUEST", settingsValidationMessage(error), 400);
		}

		return configDecryptError();
	}

	try {
		parsedSettings = await parseSettingsFromRows(
			rows,
			env.CONFIG_ENCRYPTION_KEY,
		);
	} catch (error) {
		if (isSettingsValidationError(error)) {
			return errorJson("BAD_REQUEST", settingsValidationMessage(error), 400);
		}

		return configDecryptError();
	}

	try {
		await new SettingsRepository(env.DB).putMany(rows);
	} catch {
		return settingsSaveError();
	}

	return json(redactSettings(parsedSettings));
}

async function resolveSettingsSaveToken(
	body: Record<string, unknown>,
	env: AppEnv,
): Promise<Record<string, unknown> | Response> {
	if (typeof body.notionToken === "string" && body.notionToken.length > 0) {
		return body;
	}

	if (body.notionToken !== undefined && typeof body.notionToken !== "string") {
		return body;
	}

	let rows: SettingRow[];

	try {
		rows = await new SettingsRepository(env.DB).list();
	} catch {
		return settingsLoadError();
	}

	try {
		const currentSettings = await parseSettingsFromRows(
			siteSettingRows(rows),
			env.CONFIG_ENCRYPTION_KEY,
		);

		return {
			...body,
			notionToken: currentSettings.notionToken,
		};
	} catch (error) {
		if (isMissingSettingsError(error)) {
			return errorJson("BAD_REQUEST", "Invalid settings", 400);
		}

		return configDecryptError();
	}
}

async function loadNotionSchema(
	body: ResolvedNotionSchemaBody,
): Promise<NotionProperties> {
	return new NotionClient(body.notionToken).schemaForDatabase(
		body.notionDatabaseId,
		body.dataSourceId ? { dataSourceId: body.dataSourceId } : {},
	);
}

async function resolveNotionSchemaToken(
	body: NotionSchemaBody,
	env: AppEnv,
): Promise<ResolvedNotionSchemaBody | Response> {
	if (body.notionToken) {
		return body as ResolvedNotionSchemaBody;
	}

	let rows: SettingRow[];

	try {
		rows = await new SettingsRepository(env.DB).list();
	} catch {
		return settingsLoadError();
	}

	try {
		const settings = await parseSettingsFromRows(
			siteSettingRows(rows),
			env.CONFIG_ENCRYPTION_KEY,
		);

		return {
			...body,
			notionToken: settings.notionToken,
		};
	} catch (error) {
		if (isMissingSettingsError(error)) {
			return errorJson("BAD_REQUEST", "Notion token is required", 400);
		}

		return configDecryptError();
	}
}

async function handleNotionSchema(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);

	if (csrfError) {
		return csrfError;
	}

	let body: NotionSchemaBody;

	try {
		body = validateNotionSchemaBody(await readJsonObject(request));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Invalid Notion schema request";

		return errorJson("BAD_REQUEST", message, 400);
	}

	try {
		const resolvedBody = await resolveNotionSchemaToken(body, env);

		if (resolvedBody instanceof Response) {
			return resolvedBody;
		}

		const properties = await loadNotionSchema(resolvedBody);

		return json({
			databaseId: resolvedBody.notionDatabaseId,
			properties,
			recommendedFieldMapping: inferFieldMapping(properties),
		});
	} catch (error) {
		return notionSchemaError(error);
	}
}

async function handleManualSync(
	request: Request,
	env: AppEnv,
	options: AdminApiOptions,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);

	if (csrfError) {
		return csrfError;
	}

	let body: ManualSyncBody;

	try {
		body = validateManualSyncBody(await readJsonObject(request));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Invalid request body";

		return errorJson("BAD_REQUEST", message, 400);
	}

	try {
		const syncRunner = options.runSync ?? defaultRunSync;
		return json(
			await syncRunner(env, {
				triggerType: "manual",
				rangeStart: body.rangeStart,
				rangeEnd: body.rangeEnd,
				force: body.force,
			}),
		);
	} catch {
		return errorJson("INTERNAL_ERROR", "Sync failed", 500);
	}
}

async function handleListSyncRuns(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	try {
		const result = await env.DB.prepare(
			`SELECT
				id,
				trigger_type,
				started_at,
				finished_at,
				status,
				range_start,
				range_end,
				force,
				created_count,
				updated_count,
				metadata_only_count,
				skipped_count,
				unpublished_count,
				archived_count,
				failed_count,
				error_code,
				error_message
			 FROM sync_runs
			 ORDER BY started_at DESC
			 LIMIT ?`,
		)
			.bind(20)
			.all<SyncRunRow>();

		return json({
			items: result.results.map((run) => ({
				...run,
				force: run.force === 1,
			})),
		});
	} catch {
		return errorJson("INTERNAL_ERROR", "Sync history could not be loaded", 500);
	}
}

async function handleGetPostCommentSettings(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	try {
		return json({
			defaultEnabled: await loadCommentsDefaultEnabled(env.DB),
			globalEnabled: await loadCommentsGlobalEnabled(env.DB),
		});
	} catch {
		return errorJson(
			"INTERNAL_ERROR",
			"Post comment settings could not be loaded",
			500,
		);
	}
}

async function handlePutPostCommentSettings(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);

	if (csrfError) {
		return csrfError;
	}

	let body: CommentSettingsBody;

	try {
		body = validateCommentSettingsBody(await readJsonObject(request));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Invalid request body";

		return errorJson("BAD_REQUEST", message, 400);
	}

	try {
		const currentDefaultEnabled = await loadCommentsDefaultEnabled(env.DB);
		const currentGlobalEnabled = await loadCommentsGlobalEnabled(env.DB);
		const defaultEnabled = body.defaultEnabled ?? currentDefaultEnabled;
		const globalEnabled = body.globalEnabled ?? currentGlobalEnabled;
		const now = new Date().toISOString();

		if (body.defaultEnabled !== undefined) {
			await saveCommentsDefaultEnabled(env.DB, defaultEnabled, now);
		}

		if (body.globalEnabled !== undefined) {
			await saveCommentsGlobalEnabled(env.DB, globalEnabled, now);
		}

		return json({ defaultEnabled, globalEnabled });
	} catch {
		return errorJson(
			"INTERNAL_ERROR",
			"Post comment settings could not be saved",
			500,
		);
	}
}

function decodePathSegment(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

function adminPostCommentsFromPath(pathname: string): { postId: string } | null {
	const match = /^\/api\/admin\/posts\/([^/]+)\/comments$/.exec(pathname);
	const postId = match ? decodePathSegment(match[1]) : null;

	return postId ? { postId } : null;
}

function adminPostCommentFromPath(
	pathname: string,
): { postId: string; commentId: string } | null {
	const match = /^\/api\/admin\/posts\/([^/]+)\/comments\/([^/]+)$/.exec(
		pathname,
	);
	const postId = match ? decodePathSegment(match[1]) : null;
	const commentId = match ? decodePathSegment(match[2]) : null;

	return postId && commentId ? { postId, commentId } : null;
}

async function adminPostCommentParent(
	env: AppEnv,
	postId: string,
): Promise<AdminPostCommentParentRow | null> {
	return env.DB.prepare(
		`SELECT id, title, comments_enabled
		 FROM posts
		 WHERE id = ?
		 LIMIT 1`,
	)
		.bind(postId)
		.first<AdminPostCommentParentRow>();
}

function adminPostCommentParentResponse(row: AdminPostCommentParentRow) {
	return {
		id: row.id,
		title: row.title,
		commentsEnabled: row.comments_enabled === 1,
	};
}

function adminPostCommentResponse(row: AdminPostCommentRow) {
	return {
		id: row.id,
		nickname: row.nickname,
		body: row.body,
		createdAt: row.created_at,
	};
}

async function handleGetAdminPostComments(
	request: Request,
	env: AppEnv,
	postId: string,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const post = await adminPostCommentParent(env, postId);
	if (!post) {
		return errorJson("NOT_FOUND", "Post not found", 404);
	}

	const comments = await env.DB.prepare(
		`SELECT id, nickname, body, created_at
		 FROM post_comments
		 WHERE post_id = ?
		 ORDER BY created_at DESC`,
	)
		.bind(post.id)
		.all<AdminPostCommentRow>();

	return json({
		post: adminPostCommentParentResponse(post),
		comments: comments.results.map(adminPostCommentResponse),
	});
}

async function handlePutAdminPostComments(
	request: Request,
	env: AppEnv,
	postId: string,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);
	if (csrfError) {
		return csrfError;
	}

	let body: CommentsEnabledBody;
	try {
		body = validateCommentsEnabledBody(await readJsonObject(request));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Invalid request body";

		return errorJson("BAD_REQUEST", message, 400);
	}

	const post = await adminPostCommentParent(env, postId);
	if (!post) {
		return errorJson("NOT_FOUND", "Post not found", 404);
	}

	await env.DB.prepare(
		`UPDATE posts
		 SET comments_enabled = ?, updated_at = ?
		 WHERE id = ?`,
	)
		.bind(body.enabled ? 1 : 0, new Date().toISOString(), post.id)
		.run();

	return json({
		post: {
			...adminPostCommentParentResponse(post),
			commentsEnabled: body.enabled,
		},
	});
}

async function handleDeleteAdminPostComment(
	request: Request,
	env: AppEnv,
	postId: string,
	commentId: string,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);
	if (csrfError) {
		return csrfError;
	}

	const comment = await env.DB.prepare(
		`SELECT id
		 FROM post_comments
		 WHERE id = ?
		 AND post_id = ?
		 LIMIT 1`,
	)
		.bind(commentId, postId)
		.first<{ id: string }>();

	if (!comment) {
		return errorJson("NOT_FOUND", "Comment not found", 404);
	}

	await env.DB.prepare("DELETE FROM post_comments WHERE id = ?")
		.bind(comment.id)
		.run();

	return json({ ok: true });
}

function adminPostActionFromPath(
	pathname: string,
): { postId: string; action: AdminPostAction } | null {
	const match =
		/^\/api\/admin\/posts\/([^/]+)\/(hide|restore|lock|unlock|comments-on|comments-off|delete)$/.exec(
			pathname,
		);
	if (!match) {
		return null;
	}

	return {
		postId: decodeURIComponent(match[1]),
		action: match[2] as AdminPostAction,
	};
}

function parseAdminPostsPagination(params: URLSearchParams): {
	page: number;
	limit: number;
} | null {
	const page = params.get("page") ?? "1";
	const limit = params.get("limit") ?? "20";

	if (!/^[1-9]\d*$/.test(page) || !/^[1-9]\d*$/.test(limit)) {
		return null;
	}

	return {
		page: Number(page),
		limit: Math.min(Number(limit), 100),
	};
}

function adminPostsSort(params: URLSearchParams): {
	column: string;
	direction: "ASC" | "DESC";
	sortBy: string;
	sortDirection: "asc" | "desc";
} {
	const sortBy = params.get("sortBy") ?? "updatedAt";
	const sortDirection = params.get("sortDirection") === "asc" ? "asc" : "desc";
	const columns: Record<string, string> = {
		updatedAt: "updated_at",
		publishedAt: "published_at",
		notionLastEditedTime: "notion_last_edited_time",
		title: "title",
	};

	return {
		column: columns[sortBy] ?? columns.updatedAt,
		direction: sortDirection === "asc" ? "ASC" : "DESC",
		sortBy: columns[sortBy] ? sortBy : "updatedAt",
		sortDirection,
	};
}

function adminPostsFilters(params: URLSearchParams): {
	where: string;
	values: unknown[];
	q: string;
	status: string;
} {
	const clauses: string[] = [];
	const values: unknown[] = [];
	const q = (params.get("q") ?? "").trim();
	const status = (params.get("status") ?? "").trim();

	if (q) {
		clauses.push("(title LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')");
		const pattern = `%${q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
		values.push(pattern, pattern);
	}

	if (status) {
		clauses.push("status = ?");
		values.push(status);
	}

	return {
		where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
		values,
		q,
		status,
	};
}

async function decryptPostPassword(
	encrypted: string | null,
	env: AppEnv,
): Promise<string | null> {
	if (!encrypted) {
		return null;
	}

	return decryptString(encrypted, env.CONFIG_ENCRYPTION_KEY);
}

async function handleListPosts(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	try {
		const url = new URL(request.url);
		const pagination = parseAdminPostsPagination(url.searchParams);
		if (!pagination) {
			return errorJson("BAD_REQUEST", "Invalid pagination", 400);
		}
		const filters = adminPostsFilters(url.searchParams);
		const sort = adminPostsSort(url.searchParams);
		const offset = (pagination.page - 1) * pagination.limit;
		const result = await env.DB.prepare(
			`SELECT
				id,
				title,
				slug,
				status,
				visibility,
				manual_visibility,
				locked,
				comments_enabled,
				lock_password_encrypted,
				published_at,
				notion_last_edited_time,
				updated_at,
				last_sync_error
			 FROM posts
			 ${filters.where}
			 ORDER BY ${sort.column} ${sort.direction}, updated_at DESC
			 LIMIT ? OFFSET ?`,
		)
			.bind(...filters.values, pagination.limit, offset)
			.all<AdminPostRow>();
		const countRow = await env.DB.prepare(
			`SELECT COUNT(*) AS total
			 FROM posts
			 ${filters.where}`,
		)
			.bind(...filters.values)
			.first<{ total: number }>();
		const items = await Promise.all(
			result.results.map(async (post) => ({
				id: post.id,
				title: post.title,
				slug: post.slug,
				status: post.status,
				visibility: post.visibility,
				manualVisibility: post.manual_visibility,
				locked: post.locked === 1,
				commentsEnabled: post.comments_enabled === 1,
				lockPassword: await decryptPostPassword(post.lock_password_encrypted, env),
				publishedAt: post.published_at,
				notionLastEditedTime: post.notion_last_edited_time,
				updatedAt: post.updated_at,
				lastSyncError: post.last_sync_error,
			})),
		);

		return json({
			items,
			total: Number(countRow?.total ?? 0),
			page: pagination.page,
			limit: pagination.limit,
		});
	} catch {
		return errorJson("INTERNAL_ERROR", "Posts could not be loaded", 500);
	}
}

async function handleAdminPostAction(
	request: Request,
	env: AppEnv,
	postId: string,
	action: AdminPostAction,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);

	if (csrfError) {
		return csrfError;
	}

	const now = new Date().toISOString();
	const post = await env.DB.prepare(
		`SELECT id, notion_page_id, slug, title
		 FROM posts
		 WHERE id = ?
		 LIMIT 1`,
	)
		.bind(postId)
		.first<AdminPostIdentityRow>();

	if (!post) {
		return errorJson("NOT_FOUND", "Post not found", 404);
	}

	if (action === "hide" || action === "restore") {
		await env.DB.prepare(
			`UPDATE posts
			 SET manual_visibility = ?, updated_at = ?
			 WHERE id = ?`,
		)
			.bind(action === "hide" ? "hidden" : "visible", now, post.id)
			.run();

		return json({ ok: true });
	}

	if (action === "comments-on" || action === "comments-off") {
		await env.DB.prepare(
			`UPDATE posts
			 SET comments_enabled = ?, updated_at = ?
			 WHERE id = ?`,
		)
			.bind(action === "comments-on" ? 1 : 0, now, post.id)
			.run();

		return json({ ok: true });
	}

	if (action === "lock") {
		let password: string | null = null;
		try {
			const body = await readJsonObject(request);
			password = typeof body.password === "string" ? body.password.trim() : null;
		} catch {
			password = null;
		}

		if (!password) {
			return errorJson("BAD_REQUEST", "Password is required", 400);
		}

		await env.DB.prepare(
			`UPDATE posts
			 SET locked = 1,
				 lock_password_encrypted = ?,
				 updated_at = ?
			 WHERE id = ?`,
		)
			.bind(await encryptString(password, env.CONFIG_ENCRYPTION_KEY), now, post.id)
			.run();

		return json({ ok: true });
	}

	if (action === "unlock") {
		await env.DB.prepare(
			`UPDATE posts
			 SET locked = 0,
				 lock_password_encrypted = NULL,
				 updated_at = ?
			 WHERE id = ?`,
		)
			.bind(now, post.id)
			.run();

		return json({ ok: true });
	}

	await env.DB
		.prepare(
			`INSERT INTO deleted_posts (
				notion_page_id, post_id, slug, title, deleted_at
			)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(notion_page_id) DO UPDATE SET
				post_id = excluded.post_id,
				slug = excluded.slug,
				title = excluded.title,
				deleted_at = excluded.deleted_at`,
		)
		.bind(post.notion_page_id, post.id, post.slug, post.title, now)
		.run();
	await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(post.id).run();

	return json({ ok: true });
}

export async function handleAdminApi(
	request: Request,
	env: AppEnv,
	options: AdminApiOptions = {},
): Promise<Response> {
	const url = new URL(request.url);

	if (url.pathname === "/api/admin/login" && request.method === "POST") {
		return handleLogin(request, env);
	}

	if (url.pathname === "/api/admin/me" && request.method === "GET") {
		return handleMe(request, env);
	}

	if (url.pathname === "/api/admin/logout" && request.method === "POST") {
		return handleLogout(request, env);
	}

	if (url.pathname === "/api/admin/password" && request.method === "POST") {
		return handlePasswordChange(request, env);
	}

	if (url.pathname === "/api/admin/settings" && request.method === "GET") {
		return handleGetSettings(request, env);
	}

	if (url.pathname === "/api/admin/settings" && request.method === "PUT") {
		return handlePutSettings(request, env);
	}

	if (url.pathname === "/api/admin/notion/schema" && request.method === "POST") {
		return handleNotionSchema(request, env);
	}

	if (url.pathname === "/api/admin/sync" && request.method === "POST") {
		return handleManualSync(request, env, options);
	}

	if (url.pathname === "/api/admin/sync-runs" && request.method === "GET") {
		return handleListSyncRuns(request, env);
	}

	if (url.pathname === "/api/admin/posts" && request.method === "GET") {
		return handleListPosts(request, env);
	}

	if (
		url.pathname === "/api/admin/posts/comment-settings" &&
		request.method === "GET"
	) {
		return handleGetPostCommentSettings(request, env);
	}

	if (
		url.pathname === "/api/admin/posts/comment-settings" &&
		request.method === "PUT"
	) {
		return handlePutPostCommentSettings(request, env);
	}

	const postComment = adminPostCommentFromPath(url.pathname);
	if (postComment && request.method === "DELETE") {
		return handleDeleteAdminPostComment(
			request,
			env,
			postComment.postId,
			postComment.commentId,
		);
	}

	const postComments = adminPostCommentsFromPath(url.pathname);
	if (postComments && request.method === "GET") {
		return handleGetAdminPostComments(request, env, postComments.postId);
	}

	if (postComments && request.method === "PUT") {
		return handlePutAdminPostComments(request, env, postComments.postId);
	}

	const postAction = adminPostActionFromPath(url.pathname);
	if (postAction && request.method === "POST") {
		return handleAdminPostAction(
			request,
			env,
			postAction.postId,
			postAction.action,
		);
	}

	return adminNotFound();
}
