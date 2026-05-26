import { errorJson, json, readJsonObject } from "../http";
import {
	buildAssetKey,
	cdnUrlForKey,
	contentHashForBytes,
	uploadAssetIfMissing,
} from "../assets";
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
	loadCommentsModerationEnabled,
	saveCommentsDefaultEnabled,
	saveCommentsGlobalEnabled,
	saveCommentsModerationEnabled,
} from "../comments";
import {
	parseSettingsFromRows,
	redactSettings,
	serializeSettingsForStorage,
	type SettingRow,
} from "../settings";
import { runSync as defaultRunSync, type RunSyncInput } from "../sync";
import type { AppEnv, PublicAlbumMediaKind, SiteSettings } from "../types";
import { NotionApiError, NotionClient } from "../notion/client";
import {
	inferFieldMapping,
	parseNotionDatabaseId,
	type NotionProperties,
} from "../notion/database";
import {
	createLocalDraft,
	getLocalDraft,
	localDraftResponse,
	publishLocalDraft,
	type LocalDraftInput,
	unpublishLocalDraft,
	updateLocalDraft,
	uploadLocalPostImage,
	validateLocalDraftInput,
} from "../local-posts";

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
	moderationEnabled?: boolean;
};

type CommentModerationBody = {
	moderationStatus?: "pending" | "approved";
	replyBody?: string | null;
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
	| "delete"
	| "resync";

type AdminLocalDraftAction = "publish" | "unpublish";

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
	moderation_status: "pending" | "approved";
	reply_body: string | null;
	reply_created_at: string | null;
	created_at: string;
};

type AdminAlbumItemRow = {
	id: string;
	source_type: "post_media" | "manual";
	source_id: string | null;
	post_id: string | null;
	kind: PublicAlbumMediaKind;
	url: string;
	thumbnail_url: string | null;
	large_url: string | null;
	r2_key: string | null;
	title: string;
	description: string;
	caption: string;
	taken_at: string | null;
	location_name: string;
	latitude: number | null;
	longitude: number | null;
	visibility: "visible" | "hidden";
	featured: number;
	sort_order: number;
	source_content_hash: string | null;
	exif_json: string | null;
	created_at: string;
	updated_at: string;
	post_slug: string | null;
	post_title: string | null;
};

type AdminAlbumCollectionRow = {
	id: string;
	slug: string;
	title: string;
	description: string;
	cover_item_id: string | null;
	visibility: "visible" | "hidden";
	sort_order: number;
	created_at: string;
	updated_at: string;
};

type AdminAlbumItemBody = {
	title: string;
	description: string;
	caption: string;
	takenAt: string | null;
	locationName: string;
	latitude: number | null;
	longitude: number | null;
	featured: boolean;
	collectionIds: string[];
};

type AdminAlbumCollectionBody = {
	slug: string;
	title: string;
	description: string;
	coverItemId: string | null;
	visibility: "visible" | "hidden";
	sortOrder: number;
};

type AdminAlbumItemAction = "hide" | "restore" | "delete";

type AdminAlbumBatchBody = {
	itemIds: string[];
	action: "hide" | "restore" | "delete" | "feature" | "unfeature";
};

type AdminOverviewCountsRow = {
	total_posts: number;
	published_posts: number;
	hidden_posts: number;
	locked_posts: number;
	comments: number;
};

type AdminOverviewFailedPostRow = {
	id: string;
	title: string;
	slug: string;
	last_sync_error: string;
	updated_at: string;
};

type AdminOverviewCommentRow = {
	id: string;
	nickname: string;
	body: string;
	created_at: string;
	post_id: string;
	post_title: string;
	post_slug: string;
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
const maxAlbumTextLength = 2000;
const albumMediaKinds = new Set<PublicAlbumMediaKind>([
	"image",
	"video",
	"audio",
	"pdf",
	"file",
]);

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

	if (
		body.moderationEnabled !== undefined &&
		typeof body.moderationEnabled !== "boolean"
	) {
		throw new Error("moderationEnabled must be a boolean");
	}

	const defaultEnabled =
		typeof body.defaultEnabled === "boolean"
			? body.defaultEnabled
			: typeof body.enabled === "boolean"
				? body.enabled
				: undefined;
	const globalEnabled =
		typeof body.globalEnabled === "boolean" ? body.globalEnabled : undefined;
	const moderationEnabled =
		typeof body.moderationEnabled === "boolean"
			? body.moderationEnabled
			: undefined;

	if (
		defaultEnabled === undefined &&
		globalEnabled === undefined &&
		moderationEnabled === undefined
	) {
		throw new Error("At least one comment setting is required");
	}

	return {
		...(defaultEnabled !== undefined ? { defaultEnabled } : {}),
		...(globalEnabled !== undefined ? { globalEnabled } : {}),
		...(moderationEnabled !== undefined ? { moderationEnabled } : {}),
	};
}

function validateCommentModerationBody(
	body: Record<string, unknown>,
): CommentModerationBody {
	const moderationStatus = body.moderationStatus;
	const replyBody = body.replyBody;

	if (
		moderationStatus !== undefined &&
		moderationStatus !== "pending" &&
		moderationStatus !== "approved"
	) {
		throw new Error("moderationStatus must be pending or approved");
	}

	if (
		replyBody !== undefined &&
		replyBody !== null &&
		typeof replyBody !== "string"
	) {
		throw new Error("replyBody must be a string or null");
	}

	const trimmedReply =
		typeof replyBody === "string" ? replyBody.trim() : replyBody;

	if (typeof trimmedReply === "string" && trimmedReply.length > 2000) {
		throw new Error("replyBody must be at most 2000 characters");
	}

	if (moderationStatus === undefined && replyBody === undefined) {
		throw new Error("At least one comment update is required");
	}

	return {
		...(moderationStatus !== undefined ? { moderationStatus } : {}),
		...(replyBody !== undefined ? { replyBody: trimmedReply } : {}),
	};
}

function optionalText(
	body: Record<string, unknown>,
	key: string,
	maxLength = maxAlbumTextLength,
): string {
	const value = body[key];
	if (value === undefined || value === null) {
		return "";
	}

	if (typeof value !== "string") {
		throw new Error(`${key} must be a string`);
	}

	const trimmed = value.trim();
	if (trimmed.length > maxLength) {
		throw new Error(`${key} must be at most ${maxLength} characters`);
	}

	return trimmed;
}

function optionalNullableDate(
	body: Record<string, unknown>,
	key: string,
): string | null {
	const value = body[key];
	if (value === undefined || value === null || value === "") {
		return null;
	}

	if (typeof value !== "string" || !isValidIsoDateString(value)) {
		throw new Error(`${key} must be an ISO date string or null`);
	}

	return value;
}

function optionalCoordinate(
	body: Record<string, unknown>,
	key: "latitude" | "longitude",
): number | null {
	const value = body[key];
	if (value === undefined || value === null || value === "") {
		return null;
	}

	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`${key} must be a number or null`);
	}

	const min = key === "latitude" ? -90 : -180;
	const max = key === "latitude" ? 90 : 180;
	if (value < min || value > max) {
		throw new Error(`${key} is out of range`);
	}

	return value;
}

function optionalCollectionIds(body: Record<string, unknown>): string[] {
	const value = body.collectionIds;
	if (value === undefined) {
		return [];
	}

	if (!Array.isArray(value)) {
		throw new Error("collectionIds must be an array");
	}

	return value.map((item) => {
		if (typeof item !== "string" || item.trim().length === 0) {
			throw new Error("collectionIds must contain non-empty strings");
		}

		return item.trim();
	});
}

function validateAlbumItemBody(
	body: Record<string, unknown>,
): AdminAlbumItemBody {
	const featured = body.featured;
	if (featured !== undefined && typeof featured !== "boolean") {
		throw new Error("featured must be a boolean");
	}

	return {
		title: optionalText(body, "title", 240),
		description: optionalText(body, "description"),
		caption: optionalText(body, "caption"),
		takenAt: optionalNullableDate(body, "takenAt"),
		locationName: optionalText(body, "locationName", 240),
		latitude: optionalCoordinate(body, "latitude"),
		longitude: optionalCoordinate(body, "longitude"),
		featured: featured === true,
		collectionIds: optionalCollectionIds(body),
	};
}

function slugifyAdminAlbum(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

function validateAlbumCollectionBody(
	body: Record<string, unknown>,
): AdminAlbumCollectionBody {
	const rawTitle = optionalText(body, "title", 120);
	if (!rawTitle) {
		throw new Error("title is required");
	}

	const rawSlug =
		typeof body.slug === "string" && body.slug.trim()
			? body.slug.trim()
			: slugifyAdminAlbum(rawTitle);
	const slug = slugifyAdminAlbum(rawSlug);
	if (!slug) {
		throw new Error("slug is required");
	}

	const visibility =
		body.visibility === "hidden" || body.visibility === "visible"
			? body.visibility
			: "visible";
	const sortOrder =
		typeof body.sortOrder === "number" &&
		Number.isInteger(body.sortOrder) &&
		body.sortOrder >= 0
			? body.sortOrder
			: 0;
	const coverItemId =
		typeof body.coverItemId === "string" && body.coverItemId.trim()
			? body.coverItemId.trim()
			: null;

	return {
		slug,
		title: rawTitle,
		description: optionalText(body, "description"),
		coverItemId,
		visibility,
		sortOrder,
	};
}

function validateAlbumBatchBody(
	body: Record<string, unknown>,
): AdminAlbumBatchBody {
	const itemIds = body.itemIds;
	const action = body.action;

	if (!Array.isArray(itemIds) || itemIds.length === 0) {
		throw new Error("itemIds must be a non-empty array");
	}

	if (
		action !== "hide" &&
		action !== "restore" &&
		action !== "delete" &&
		action !== "feature" &&
		action !== "unfeature"
	) {
		throw new Error("Invalid batch action");
	}

	return {
		itemIds: itemIds.map((item) => {
			if (typeof item !== "string" || item.trim().length === 0) {
				throw new Error("itemIds must contain non-empty strings");
			}

			return item.trim();
		}),
		action,
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

async function handleOverview(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	try {
		const counts = await env.DB.prepare(
			`SELECT
				COUNT(*) AS total_posts,
				COALESCE(SUM(
					CASE
						WHEN visibility = 'published' AND manual_visibility = 'visible'
						THEN 1 ELSE 0
					END
				), 0) AS published_posts,
				COALESCE(SUM(
					CASE
						WHEN visibility <> 'published' OR manual_visibility = 'hidden'
						THEN 1 ELSE 0
					END
				), 0) AS hidden_posts,
				COALESCE(SUM(CASE WHEN locked = 1 THEN 1 ELSE 0 END), 0) AS locked_posts,
				(SELECT COUNT(*) FROM post_comments) AS comments
			 FROM posts`,
		).first<AdminOverviewCountsRow>();
		const latestSyncRun = await env.DB.prepare(
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
			 LIMIT 1`,
		).first<SyncRunRow>();
		const failedPosts = await env.DB.prepare(
			`SELECT id, title, slug, last_sync_error, updated_at
			 FROM posts
			 WHERE last_sync_error IS NOT NULL
			 AND TRIM(last_sync_error) <> ''
			 ORDER BY updated_at DESC
			 LIMIT 5`,
		).all<AdminOverviewFailedPostRow>();
		const recentComments = await env.DB.prepare(
			`SELECT
				pc.id,
				pc.nickname,
				pc.body,
				pc.created_at,
				p.id AS post_id,
				p.title AS post_title,
				p.slug AS post_slug
			 FROM post_comments pc
			 JOIN posts p ON p.id = pc.post_id
			 ORDER BY pc.created_at DESC
			 LIMIT 5`,
		).all<AdminOverviewCommentRow>();

		return json({
			counts: {
				totalPosts: Number(counts?.total_posts ?? 0),
				publishedPosts: Number(counts?.published_posts ?? 0),
				hiddenPosts: Number(counts?.hidden_posts ?? 0),
				lockedPosts: Number(counts?.locked_posts ?? 0),
				comments: Number(counts?.comments ?? 0),
			},
			latestSyncRun: latestSyncRun
				? {
						id: latestSyncRun.id,
						triggerType: latestSyncRun.trigger_type,
						status: latestSyncRun.status,
						startedAt: latestSyncRun.started_at,
						finishedAt: latestSyncRun.finished_at,
						failedCount: latestSyncRun.failed_count,
						errorMessage: latestSyncRun.error_message,
					}
				: null,
			failedPosts: failedPosts.results.map((post) => ({
				id: post.id,
				title: post.title,
				slug: post.slug,
				lastSyncError: post.last_sync_error,
				updatedAt: post.updated_at,
			})),
			recentComments: recentComments.results.map((comment) => ({
				id: comment.id,
				nickname: comment.nickname,
				body: comment.body,
				createdAt: comment.created_at,
				postId: comment.post_id,
				postTitle: comment.post_title,
				postSlug: comment.post_slug,
			})),
		});
	} catch {
		return errorJson("INTERNAL_ERROR", "Overview could not be loaded", 500);
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
			moderationEnabled: await loadCommentsModerationEnabled(env.DB),
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
		const currentModerationEnabled =
			await loadCommentsModerationEnabled(env.DB);
		const defaultEnabled = body.defaultEnabled ?? currentDefaultEnabled;
		const globalEnabled = body.globalEnabled ?? currentGlobalEnabled;
		const moderationEnabled =
			body.moderationEnabled ?? currentModerationEnabled;
		const now = new Date().toISOString();

		if (body.defaultEnabled !== undefined) {
			await saveCommentsDefaultEnabled(env.DB, defaultEnabled, now);
		}

		if (body.globalEnabled !== undefined) {
			await saveCommentsGlobalEnabled(env.DB, globalEnabled, now);
		}

		if (body.moderationEnabled !== undefined) {
			await saveCommentsModerationEnabled(env.DB, moderationEnabled, now);
		}

		return json({ defaultEnabled, globalEnabled, moderationEnabled });
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

function adminLocalDraftPath(pathname: string): { draftId: string } | null {
	const match = /^\/api\/admin\/local-posts\/([^/]+)$/.exec(pathname);
	const draftId = match ? decodePathSegment(match[1]) : null;

	return draftId ? { draftId } : null;
}

function adminLocalDraftActionPath(
	pathname: string,
): { draftId: string; action: AdminLocalDraftAction } | null {
	const match = /^\/api\/admin\/local-posts\/([^/]+)\/(publish|unpublish)$/.exec(
		pathname,
	);
	const draftId = match ? decodePathSegment(match[1]) : null;
	const action = match?.[2] as AdminLocalDraftAction | undefined;

	return draftId && action ? { draftId, action } : null;
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
		moderationStatus: row.moderation_status,
		replyBody: row.reply_body,
		replyCreatedAt: row.reply_created_at,
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
		`SELECT
			id,
			nickname,
			body,
			moderation_status,
			reply_body,
			reply_created_at,
			created_at
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

async function handlePutAdminPostComment(
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

	let body: CommentModerationBody;
	try {
		body = validateCommentModerationBody(await readJsonObject(request));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Invalid request body";

		return errorJson("BAD_REQUEST", message, 400);
	}

	const existing = await env.DB.prepare(
		`SELECT
			id,
			nickname,
			body,
			moderation_status,
			reply_body,
			reply_created_at,
			created_at
		 FROM post_comments
		 WHERE id = ?
		 AND post_id = ?
		 LIMIT 1`,
	)
		.bind(commentId, postId)
		.first<AdminPostCommentRow>();

	if (!existing) {
		return errorJson("NOT_FOUND", "Comment not found", 404);
	}

	const replyBody =
		body.replyBody !== undefined ? body.replyBody : existing.reply_body;
	const replyCreatedAt =
		body.replyBody !== undefined
			? replyBody
				? (existing.reply_created_at ?? new Date().toISOString())
				: null
			: existing.reply_created_at;
	const moderationStatus = body.moderationStatus ?? existing.moderation_status;

	await env.DB.prepare(
		`UPDATE post_comments
		 SET moderation_status = ?, reply_body = ?, reply_created_at = ?
		 WHERE id = ?
		 AND post_id = ?`,
	)
		.bind(moderationStatus, replyBody, replyCreatedAt, commentId, postId)
		.run();

	return json({
		comment: adminPostCommentResponse({
			...existing,
			moderation_status: moderationStatus,
			reply_body: replyBody,
			reply_created_at: replyCreatedAt,
		}),
	});
}

function adminPostActionFromPath(
	pathname: string,
): { postId: string; action: AdminPostAction } | null {
	const match =
		/^\/api\/admin\/posts\/([^/]+)\/(hide|restore|lock|unlock|comments-on|comments-off|delete|resync)$/.exec(
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

async function handleCreateLocalDraft(
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

	let body: LocalDraftInput;
	let draftInput: ReturnType<typeof validateLocalDraftInput>;
	try {
		body = (await readJsonObject(request)) as unknown as LocalDraftInput;
		draftInput = validateLocalDraftInput(body);
	} catch (error) {
		return errorJson(
			"BAD_REQUEST",
			error instanceof Error ? error.message : "Invalid request body",
			400,
		);
	}

	try {
		const draft = await createLocalDraft(env, draftInput);
		return json({ draft: localDraftResponse(draft) });
	} catch {
		return errorJson("INTERNAL_ERROR", "Draft could not be saved", 500);
	}
}

async function handleGetLocalDraft(
	request: Request,
	env: AppEnv,
	draftId: string,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const draft = await getLocalDraft(env, draftId);
	if (!draft) {
		return errorJson("NOT_FOUND", "Local draft not found", 404);
	}

	return json({ draft: localDraftResponse(draft) });
}

async function handleUpdateLocalDraft(
	request: Request,
	env: AppEnv,
	draftId: string,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);
	if (csrfError) {
		return csrfError;
	}

	let body: LocalDraftInput;
	let draftInput: ReturnType<typeof validateLocalDraftInput>;
	try {
		body = (await readJsonObject(request)) as unknown as LocalDraftInput;
		draftInput = validateLocalDraftInput(body);
	} catch (error) {
		return errorJson(
			"BAD_REQUEST",
			error instanceof Error ? error.message : "Invalid request body",
			400,
		);
	}

	try {
		const draft = await updateLocalDraft(env, draftId, draftInput);
		if (!draft) {
			return errorJson("NOT_FOUND", "Local draft not found", 404);
		}

		return json({ draft: localDraftResponse(draft) });
	} catch {
		return errorJson("INTERNAL_ERROR", "Draft could not be saved", 500);
	}
}

function localDraftActionValidationMessage(error: unknown): string | null {
	if (!(error instanceof Error)) {
		return null;
	}

	const validationMessages = new Set([
		"Slug already exists",
		"Slug is required",
		"Markdown is required",
		"Title is required",
		"Slug must be a string",
		"Slug must contain only lowercase letters, numbers, and hyphens",
		"Excerpt must be a string",
		"Markdown must be a string",
		"Cover URL must be a string",
		"Category must be a string",
		"Tags must be an array",
		"Tags must contain only strings",
		"Comments enabled must be a boolean",
		"Published date must be a string",
	]);

	return validationMessages.has(error.message) ? error.message : null;
}

async function handleLocalDraftAction(
	request: Request,
	env: AppEnv,
	draftId: string,
	action: AdminLocalDraftAction,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);
	if (csrfError) {
		return csrfError;
	}

	try {
		const draft =
			action === "publish"
				? await publishLocalDraft(env, draftId)
				: await unpublishLocalDraft(env, draftId);

		if (!draft) {
			return errorJson("NOT_FOUND", "Local draft not found", 404);
		}

		return json({ draft: localDraftResponse(draft) });
	} catch (error) {
		const validationMessage = localDraftActionValidationMessage(error);
		if (validationMessage) {
			return errorJson("BAD_REQUEST", validationMessage, 400);
		}

		return errorJson("INTERNAL_ERROR", "Draft could not be saved", 500);
	}
}

async function handleUploadLocalPostImage(
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

	try {
		const asset = await uploadLocalPostImage(env, request);

		return json({ asset });
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		if (
			message === "Unsupported image type" ||
			message === "Image must be at most 10MB"
		) {
			return errorJson("BAD_REQUEST", message, 400);
		}

		if (message === "R2_UPLOAD_FAILED") {
			return errorJson("R2_UPLOAD_FAILED", "Asset upload failed", 502);
		}

		return errorJson("INTERNAL_ERROR", "Asset could not be saved", 500);
	}
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
	options: AdminApiOptions = {},
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

	if (action === "resync") {
		const syncRunner = options.runSync ?? defaultRunSync;
		const result = await syncRunner(env, {
			triggerType: "manual",
			rangeStart: null,
			rangeEnd: null,
			force: true,
			notionPageId: post.notion_page_id,
		});

		return json(result);
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

function parseAdminAlbumPagination(params: URLSearchParams): {
	page: number;
	limit: number;
} | null {
	const page = params.get("page") ?? "1";
	const limit = params.get("limit") ?? "30";

	if (!/^[1-9]\d*$/.test(page) || !/^[1-9]\d*$/.test(limit)) {
		return null;
	}

	return {
		page: Number(page),
		limit: Math.min(Number(limit), 100),
	};
}

function adminAlbumFilters(params: URLSearchParams): {
	where: string;
	values: unknown[];
} | Response {
	const clauses: string[] = [];
	const values: unknown[] = [];
	const q = (params.get("q") ?? "").trim();
	const kind = (params.get("kind") ?? "").trim();
	const visibility = (params.get("visibility") ?? "").trim();
	const featured = (params.get("featured") ?? "").trim();
	const collection = (params.get("collection") ?? "").trim();

	if (q) {
		clauses.push(
			`(
				ai.title LIKE ? ESCAPE '\\'
				OR ai.description LIKE ? ESCAPE '\\'
				OR ai.caption LIKE ? ESCAPE '\\'
				OR COALESCE(p.title, '') LIKE ? ESCAPE '\\'
			)`,
		);
		const pattern = `%${q.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
		values.push(pattern, pattern, pattern, pattern);
	}

	if (kind) {
		if (!albumMediaKinds.has(kind as PublicAlbumMediaKind)) {
			return errorJson("BAD_REQUEST", "Invalid album media kind", 400);
		}
		clauses.push("ai.kind = ?");
		values.push(kind);
	}

	if (visibility) {
		if (visibility !== "visible" && visibility !== "hidden") {
			return errorJson("BAD_REQUEST", "Invalid album visibility", 400);
		}
		clauses.push("ai.visibility = ?");
		values.push(visibility);
	}

	if (featured) {
		clauses.push("ai.featured = ?");
		values.push(featured === "1" || featured.toLowerCase() === "true" ? 1 : 0);
	}

	if (collection) {
		clauses.push(
			`EXISTS (
				SELECT 1
				FROM album_item_collections filter_aic
				WHERE filter_aic.item_id = ai.id
				AND filter_aic.collection_id = ?
			)`,
		);
		values.push(collection);
	}

	return {
		where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
		values,
	};
}

async function albumCollectionIdsForItems(
	env: AppEnv,
	itemIds: string[],
): Promise<Map<string, string[]>> {
	if (itemIds.length === 0) {
		return new Map();
	}

	const placeholders = itemIds.map(() => "?").join(", ");
	const result = await env.DB.prepare(
		`SELECT item_id, collection_id
		 FROM album_item_collections
		 WHERE item_id IN (${placeholders})
		 ORDER BY item_id ASC, sort_order ASC, collection_id ASC`,
	)
		.bind(...itemIds)
		.all<{ item_id: string; collection_id: string }>();
	const idsByItem = new Map<string, string[]>();

	for (const row of result.results) {
		const ids = idsByItem.get(row.item_id) ?? [];
		ids.push(row.collection_id);
		idsByItem.set(row.item_id, ids);
	}

	return idsByItem;
}

function adminAlbumCollectionResponse(row: AdminAlbumCollectionRow) {
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		description: row.description,
		coverItemId: row.cover_item_id,
		visibility: row.visibility,
		sortOrder: Number(row.sort_order),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function adminAlbumItemResponse(
	row: AdminAlbumItemRow,
	collectionIds: string[] = [],
) {
	return {
		id: row.id,
		sourceType: row.source_type,
		sourceId: row.source_id,
		kind: row.kind,
		url: row.url,
		thumbnailUrl: row.thumbnail_url,
		largeUrl: row.large_url,
		r2Key: row.r2_key,
		title: row.title,
		description: row.description,
		caption: row.caption,
		takenAt: row.taken_at,
		locationName: row.location_name,
		latitude: row.latitude,
		longitude: row.longitude,
		visibility: row.visibility,
		featured: row.featured === 1,
		sortOrder: Number(row.sort_order),
		sourceContentHash: row.source_content_hash,
		exifJson: row.exif_json,
		collectionIds,
		post: row.post_id
			? {
					id: row.post_id,
					slug: row.post_slug,
					title: row.post_title,
				}
			: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function listAdminAlbumCollections(
	env: AppEnv,
): Promise<AdminAlbumCollectionRow[]> {
	const result = await env.DB.prepare(
		`SELECT
			id, slug, title, description, cover_item_id, visibility, sort_order,
			created_at, updated_at
		 FROM album_collections
		 ORDER BY sort_order ASC, title ASC`,
	).all<AdminAlbumCollectionRow>();

	return result.results;
}

async function adminAlbumItemById(
	env: AppEnv,
	itemId: string,
): Promise<AdminAlbumItemRow | null> {
	return env.DB.prepare(
		`SELECT
			ai.id,
			ai.source_type,
			ai.source_id,
			ai.post_id,
			ai.kind,
			ai.url,
			ai.thumbnail_url,
			ai.large_url,
			ai.r2_key,
			ai.title,
			ai.description,
			ai.caption,
			ai.taken_at,
			ai.location_name,
			ai.latitude,
			ai.longitude,
			ai.visibility,
			ai.featured,
			ai.sort_order,
			ai.source_content_hash,
			ai.exif_json,
			ai.created_at,
			ai.updated_at,
			p.slug AS post_slug,
			p.title AS post_title
		 FROM album_items ai
		 LEFT JOIN posts p ON p.id = ai.post_id
		 WHERE ai.id = ?
		 LIMIT 1`,
	)
		.bind(itemId)
		.first<AdminAlbumItemRow>();
}

async function replaceAlbumItemCollections(
	env: AppEnv,
	itemId: string,
	collectionIds: string[],
): Promise<void> {
	await env.DB.prepare("DELETE FROM album_item_collections WHERE item_id = ?")
		.bind(itemId)
		.run();

	for (const [index, collectionId] of collectionIds.entries()) {
		await env.DB.prepare(
			`INSERT INTO album_item_collections (item_id, collection_id, sort_order)
			 VALUES (?, ?, ?)`,
		)
			.bind(itemId, collectionId, index)
			.run();
	}
}

async function handleListAdminAlbum(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const url = new URL(request.url);
	const pagination = parseAdminAlbumPagination(url.searchParams);
	if (!pagination) {
		return errorJson("BAD_REQUEST", "Invalid pagination", 400);
	}

	const filters = adminAlbumFilters(url.searchParams);
	if (filters instanceof Response) {
		return filters;
	}

	const offset = (pagination.page - 1) * pagination.limit;
	const result = await env.DB.prepare(
		`SELECT
			ai.id,
			ai.source_type,
			ai.source_id,
			ai.post_id,
			ai.kind,
			ai.url,
			ai.thumbnail_url,
			ai.large_url,
			ai.r2_key,
			ai.title,
			ai.description,
			ai.caption,
			ai.taken_at,
			ai.location_name,
			ai.latitude,
			ai.longitude,
			ai.visibility,
			ai.featured,
			ai.sort_order,
			ai.source_content_hash,
			ai.exif_json,
			ai.created_at,
			ai.updated_at,
			p.slug AS post_slug,
			p.title AS post_title
		 FROM album_items ai
		 LEFT JOIN posts p ON p.id = ai.post_id
		 ${filters.where}
		 ORDER BY COALESCE(ai.taken_at, ai.updated_at) DESC, ai.sort_order ASC, ai.id ASC
		 LIMIT ? OFFSET ?`,
	)
		.bind(...filters.values, pagination.limit, offset)
		.all<AdminAlbumItemRow>();
	const countRow = await env.DB.prepare(
		`SELECT COUNT(*) AS total
		 FROM album_items ai
		 LEFT JOIN posts p ON p.id = ai.post_id
		 ${filters.where}`,
	)
		.bind(...filters.values)
		.first<{ total: number }>();
	const collectionIds = await albumCollectionIdsForItems(
		env,
		result.results.map((item) => item.id),
	);
	const collections = await listAdminAlbumCollections(env);

	return json({
		items: result.results.map((item) =>
			adminAlbumItemResponse(item, collectionIds.get(item.id) ?? []),
		),
		total: Number(countRow?.total ?? 0),
		page: pagination.page,
		limit: pagination.limit,
		collections: collections.map(adminAlbumCollectionResponse),
	});
}

async function handleUpdateAdminAlbumItem(
	request: Request,
	env: AppEnv,
	itemId: string,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);
	if (csrfError) {
		return csrfError;
	}

	let body: AdminAlbumItemBody;
	try {
		body = validateAlbumItemBody(await readJsonObject(request));
	} catch (error) {
		return errorJson(
			"BAD_REQUEST",
			error instanceof Error ? error.message : "Invalid request body",
			400,
		);
	}

	const existing = await adminAlbumItemById(env, itemId);
	if (!existing) {
		return errorJson("NOT_FOUND", "Album item not found", 404);
	}

	const now = new Date().toISOString();
	await env.DB.prepare(
		`UPDATE album_items
		 SET title = ?,
			 description = ?,
			 caption = ?,
			 taken_at = ?,
			 location_name = ?,
			 latitude = ?,
			 longitude = ?,
			 featured = ?,
			 updated_at = ?
		 WHERE id = ?`,
	)
		.bind(
			body.title,
			body.description,
			body.caption,
			body.takenAt,
			body.locationName,
			body.latitude,
			body.longitude,
			body.featured ? 1 : 0,
			now,
			itemId,
		)
		.run();
	await replaceAlbumItemCollections(env, itemId, body.collectionIds);

	const updated = await adminAlbumItemById(env, itemId);
	const collectionIds = await albumCollectionIdsForItems(env, [itemId]);

	return json({
		item: updated
			? adminAlbumItemResponse(updated, collectionIds.get(itemId) ?? [])
			: null,
	});
}

async function handleAdminAlbumItemAction(
	request: Request,
	env: AppEnv,
	itemId: string,
	action: AdminAlbumItemAction,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);
	if (csrfError) {
		return csrfError;
	}

	const existing = await adminAlbumItemById(env, itemId);
	if (!existing) {
		return errorJson("NOT_FOUND", "Album item not found", 404);
	}

	if (action === "delete") {
		await env.DB.prepare("DELETE FROM album_items WHERE id = ?").bind(itemId).run();
		return json({ ok: true });
	}

	await env.DB.prepare(
		`UPDATE album_items
		 SET visibility = ?, updated_at = ?
		 WHERE id = ?`,
	)
		.bind(
			action === "hide" ? "hidden" : "visible",
			new Date().toISOString(),
			itemId,
		)
		.run();

	return json({ ok: true });
}

async function handleAdminAlbumBatch(
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

	let body: AdminAlbumBatchBody;
	try {
		body = validateAlbumBatchBody(await readJsonObject(request));
	} catch (error) {
		return errorJson(
			"BAD_REQUEST",
			error instanceof Error ? error.message : "Invalid request body",
			400,
		);
	}

	const itemIds = Array.from(new Set(body.itemIds));
	const placeholders = itemIds.map(() => "?").join(", ");

	if (body.action === "delete") {
		await env.DB.prepare(
			`DELETE FROM album_items
			 WHERE id IN (${placeholders})`,
		)
			.bind(...itemIds)
			.run();

		return json({ ok: true, updated: itemIds.length });
	}

	const now = new Date().toISOString();
	if (body.action === "hide" || body.action === "restore") {
		await env.DB.prepare(
			`UPDATE album_items
			 SET visibility = ?, updated_at = ?
			 WHERE id IN (${placeholders})`,
		)
			.bind(body.action === "hide" ? "hidden" : "visible", now, ...itemIds)
			.run();

		return json({ ok: true, updated: itemIds.length });
	}

	await env.DB.prepare(
		`UPDATE album_items
		 SET featured = ?, updated_at = ?
		 WHERE id IN (${placeholders})`,
	)
		.bind(body.action === "feature" ? 1 : 0, now, ...itemIds)
		.run();

	return json({ ok: true, updated: itemIds.length });
}

async function handleListAdminAlbumCollections(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const collections = await listAdminAlbumCollections(env);
	return json({ items: collections.map(adminAlbumCollectionResponse) });
}

async function handleCreateAdminAlbumCollection(
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

	let body: AdminAlbumCollectionBody;
	try {
		body = validateAlbumCollectionBody(await readJsonObject(request));
	} catch (error) {
		return errorJson(
			"BAD_REQUEST",
			error instanceof Error ? error.message : "Invalid request body",
			400,
		);
	}

	const now = new Date().toISOString();
	const id = randomToken(12);
	await env.DB.prepare(
		`INSERT INTO album_collections (
			id, slug, title, description, cover_item_id, visibility, sort_order,
			created_at, updated_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			body.slug,
			body.title,
			body.description,
			body.coverItemId,
			body.visibility,
			body.sortOrder,
			now,
			now,
		)
		.run();

	const collection = await env.DB.prepare(
		`SELECT
			id, slug, title, description, cover_item_id, visibility, sort_order,
			created_at, updated_at
		 FROM album_collections
		 WHERE id = ?`,
	)
		.bind(id)
		.first<AdminAlbumCollectionRow>();

	return json({
		collection: collection ? adminAlbumCollectionResponse(collection) : null,
	});
}

async function handleUpdateAdminAlbumCollection(
	request: Request,
	env: AppEnv,
	collectionId: string,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);
	if (csrfError) {
		return csrfError;
	}

	let body: AdminAlbumCollectionBody;
	try {
		body = validateAlbumCollectionBody(await readJsonObject(request));
	} catch (error) {
		return errorJson(
			"BAD_REQUEST",
			error instanceof Error ? error.message : "Invalid request body",
			400,
		);
	}

	const now = new Date().toISOString();
	const result = await env.DB.prepare(
		`UPDATE album_collections
		 SET slug = ?,
			 title = ?,
			 description = ?,
			 cover_item_id = ?,
			 visibility = ?,
			 sort_order = ?,
			 updated_at = ?
		 WHERE id = ?`,
	)
		.bind(
			body.slug,
			body.title,
			body.description,
			body.coverItemId,
			body.visibility,
			body.sortOrder,
			now,
			collectionId,
		)
		.run();

	void result;
	const collection = await env.DB.prepare(
		`SELECT
			id, slug, title, description, cover_item_id, visibility, sort_order,
			created_at, updated_at
		 FROM album_collections
		 WHERE id = ?`,
	)
		.bind(collectionId)
		.first<AdminAlbumCollectionRow>();

	if (!collection) {
		return errorJson("NOT_FOUND", "Album collection not found", 404);
	}

	return json({ collection: adminAlbumCollectionResponse(collection) });
}

async function handleDeleteAdminAlbumCollection(
	request: Request,
	env: AppEnv,
	collectionId: string,
): Promise<Response> {
	const session = await requireUsableAdminSession(request, env);

	if (session instanceof Response) {
		return session;
	}

	const csrfError = requireCsrf(request, session);
	if (csrfError) {
		return csrfError;
	}

	await env.DB.prepare("DELETE FROM album_collections WHERE id = ?")
		.bind(collectionId)
		.run();

	return json({ ok: true });
}

function adminAlbumItemPath(pathname: string): { itemId: string } | null {
	const match = /^\/api\/admin\/album\/items\/([^/]+)$/.exec(pathname);
	const itemId = match ? decodePathSegment(match[1]) : null;

	return itemId ? { itemId } : null;
}

function adminAlbumItemActionPath(
	pathname: string,
): { itemId: string; action: AdminAlbumItemAction } | null {
	const match = /^\/api\/admin\/album\/items\/([^/]+)\/(hide|restore|delete)$/.exec(
		pathname,
	);
	if (!match) {
		return null;
	}

	const itemId = match ? decodePathSegment(match[1]) : null;

	return itemId ? { itemId, action: match[2] as AdminAlbumItemAction } : null;
}

function adminAlbumCollectionPath(
	pathname: string,
): { collectionId: string } | null {
	const match = /^\/api\/admin\/album\/collections\/([^/]+)$/.exec(pathname);
	const collectionId = match ? decodePathSegment(match[1]) : null;

	return collectionId ? { collectionId } : null;
}

async function cdnBaseUrlForUpload(env: AppEnv): Promise<string> {
	const rows = await new SettingsRepository(env.DB).list();
	const settings = await parseSettingsFromRows(
		siteSettingRows(rows),
		env.CONFIG_ENCRYPTION_KEY,
	);

	return settings.cdnBaseUrl;
}

function formString(formData: FormData, key: string): string {
	const value = formData.get(key);
	return typeof value === "string" ? value.trim() : "";
}

function albumKindForUpload(
	fileName: string,
	mimeType: string | null,
): PublicAlbumMediaKind {
	const normalizedMime = (mimeType ?? "").split(";")[0]?.trim().toLowerCase();
	if (normalizedMime?.startsWith("image/")) {
		return "image";
	}
	if (normalizedMime?.startsWith("video/")) {
		return "video";
	}
	if (normalizedMime?.startsWith("audio/")) {
		return "audio";
	}
	if (normalizedMime === "application/pdf") {
		return "pdf";
	}

	const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
	if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(extension)) {
		return "image";
	}
	if (["mp4", "webm", "mov"].includes(extension)) {
		return "video";
	}
	if (["mp3", "m4a", "wav", "ogg"].includes(extension)) {
		return "audio";
	}
	if (extension === "pdf") {
		return "pdf";
	}

	return "file";
}

function isUploadFile(value: FormDataEntryValue | null): value is File {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
		typeof (value as { name?: unknown }).name === "string"
	);
}

type ManualAlbumUploadInput = {
	bytes: ArrayBuffer;
	fileName: string;
	mimeType: string | null;
	title: string;
	description: string;
	caption: string;
	locationName: string;
	takenAt: string | null;
	featured: boolean;
};

function base64ToArrayBuffer(value: string): ArrayBuffer {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}

	return bytes.buffer;
}

async function jsonManualAlbumUploadInput(
	request: Request,
): Promise<ManualAlbumUploadInput | Response> {
	let body: Record<string, unknown>;
	try {
		body = await readJsonObject(request);
	} catch {
		return errorJson("BAD_REQUEST", "Invalid upload form data", 400);
	}

	if (
		typeof body.fileName !== "string" ||
		body.fileName.trim().length === 0 ||
		typeof body.contentBase64 !== "string" ||
		body.contentBase64.length === 0
	) {
		return errorJson("BAD_REQUEST", "file is required", 400);
	}

	return {
		bytes: base64ToArrayBuffer(body.contentBase64),
		fileName: body.fileName.trim(),
		mimeType: typeof body.contentType === "string" ? body.contentType : null,
		title: optionalText(body, "title", 240) || body.fileName.trim(),
		description: optionalText(body, "description"),
		caption: optionalText(body, "caption"),
		locationName: optionalText(body, "locationName", 240),
		takenAt: optionalNullableDate(body, "takenAt"),
		featured: body.featured === true,
	};
}

async function formManualAlbumUploadInput(
	request: Request,
): Promise<ManualAlbumUploadInput | Response> {
	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return errorJson("BAD_REQUEST", "Invalid upload form data", 400);
	}

	const fileValue = formData.get("file");
	if (!isUploadFile(fileValue)) {
		return errorJson("BAD_REQUEST", "file is required", 400);
	}

	const takenAtValue = formString(formData, "takenAt");
	const featuredValue = formString(formData, "featured").toLowerCase();

	return {
		bytes: await fileValue.arrayBuffer(),
		fileName: fileValue.name,
		mimeType: fileValue.type || null,
		title: formString(formData, "title") || fileValue.name || "Untitled",
		description: formString(formData, "description"),
		caption: formString(formData, "caption"),
		locationName: formString(formData, "locationName"),
		takenAt:
			takenAtValue && isValidIsoDateString(takenAtValue) ? takenAtValue : null,
		featured: featuredValue === "1" || featuredValue === "true",
	};
}

async function createManualAlbumItem(
	env: AppEnv,
	input: ManualAlbumUploadInput,
) {
	const contentHash = await contentHashForBytes(input.bytes);
	const r2Key = buildAssetKey(contentHash, input.mimeType);
	const cdnUrl = cdnUrlForKey(await cdnBaseUrlForUpload(env), r2Key);
	const now = new Date().toISOString();
	const itemId = randomToken(12);
	const kind = albumKindForUpload(input.fileName, input.mimeType);

	await uploadAssetIfMissing(env.BLOG_ASSETS, r2Key, input.bytes, {
		contentType: input.mimeType ?? undefined,
		cacheControl: "public, max-age=31536000, immutable",
	});
	await env.DB.prepare(
		`INSERT INTO album_items (
			id, source_type, source_id, post_id, kind, url, thumbnail_url, large_url,
			r2_key, title, description, caption, taken_at, location_name, latitude,
			longitude, visibility, featured, sort_order, source_content_hash,
			exif_json, created_at, updated_at
		)
		VALUES (?, 'manual', NULL, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL,
			NULL, 'visible', ?, 0, ?, ?, ?, ?)`,
	)
		.bind(
			itemId,
			kind,
			cdnUrl,
			cdnUrl,
			r2Key,
			input.title,
			input.description,
			input.caption,
			input.takenAt,
			input.locationName,
			input.featured ? 1 : 0,
			contentHash,
			JSON.stringify({
				fileName: input.fileName,
				mimeType: input.mimeType,
				size: input.bytes.byteLength,
				contentHash,
			}),
			now,
			now,
		)
		.run();

	return adminAlbumItemById(env, itemId);
}

async function handleUploadAdminAlbumItem(
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

	const uploadInput =
		request.headers.get("content-type")?.includes("application/json") === true
			? await jsonManualAlbumUploadInput(request)
			: await formManualAlbumUploadInput(request);

	if (uploadInput instanceof Response) {
		return uploadInput;
	}

	const item = await createManualAlbumItem(env, uploadInput);

	return json({
		item: item ? adminAlbumItemResponse(item) : null,
	});
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

	if (url.pathname === "/api/admin/overview" && request.method === "GET") {
		return handleOverview(request, env);
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

	if (url.pathname === "/api/admin/local-posts" && request.method === "POST") {
		return handleCreateLocalDraft(request, env);
	}

	if (url.pathname === "/api/admin/uploads" && request.method === "POST") {
		return handleUploadLocalPostImage(request, env);
	}

	const localDraftAction = adminLocalDraftActionPath(url.pathname);
	if (localDraftAction && request.method === "POST") {
		return handleLocalDraftAction(
			request,
			env,
			localDraftAction.draftId,
			localDraftAction.action,
		);
	}

	const localDraft = adminLocalDraftPath(url.pathname);
	if (localDraft && request.method === "GET") {
		return handleGetLocalDraft(request, env, localDraft.draftId);
	}

	if (localDraft && request.method === "PUT") {
		return handleUpdateLocalDraft(request, env, localDraft.draftId);
	}

	if (url.pathname === "/api/admin/album" && request.method === "GET") {
		return handleListAdminAlbum(request, env);
	}

	if (url.pathname === "/api/admin/album/batch" && request.method === "POST") {
		return handleAdminAlbumBatch(request, env);
	}

	if (
		url.pathname === "/api/admin/album/collections" &&
		request.method === "GET"
	) {
		return handleListAdminAlbumCollections(request, env);
	}

	if (
		url.pathname === "/api/admin/album/collections" &&
		request.method === "POST"
	) {
		return handleCreateAdminAlbumCollection(request, env);
	}

	if (url.pathname === "/api/admin/album/upload" && request.method === "POST") {
		return handleUploadAdminAlbumItem(request, env);
	}

	const albumCollection = adminAlbumCollectionPath(url.pathname);
	if (albumCollection && request.method === "PUT") {
		return handleUpdateAdminAlbumCollection(
			request,
			env,
			albumCollection.collectionId,
		);
	}

	if (albumCollection && request.method === "DELETE") {
		return handleDeleteAdminAlbumCollection(
			request,
			env,
			albumCollection.collectionId,
		);
	}

	const albumItemAction = adminAlbumItemActionPath(url.pathname);
	if (albumItemAction && request.method === "POST") {
		return handleAdminAlbumItemAction(
			request,
			env,
			albumItemAction.itemId,
			albumItemAction.action,
		);
	}

	const albumItem = adminAlbumItemPath(url.pathname);
	if (albumItem && request.method === "PUT") {
		return handleUpdateAdminAlbumItem(request, env, albumItem.itemId);
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
	if (postComment && request.method === "PUT") {
		return handlePutAdminPostComment(
			request,
			env,
			postComment.postId,
			postComment.commentId,
		);
	}

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
			options,
		);
	}

	return adminNotFound();
}
