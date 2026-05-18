import { errorJson, json, readJsonObject } from "../http";
import {
	createSessionToken,
	initialAdminPassword,
	shouldBootstrapPassword,
	verifySessionToken,
	type AdminSession,
} from "../auth";
import { parseCookies, serializeCookie } from "../cookies";
import { hashPassword, randomToken, verifyPassword } from "../crypto";
import { SettingsRepository } from "../db/d1";
import {
	parseSettingsFromRows,
	redactSettings,
	serializeSettingsForStorage,
	type SettingRow,
} from "../settings";
import { runSync as defaultRunSync, type RunSyncInput } from "../sync";
import type { AppEnv, SiteSettings } from "../types";

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
	/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/;
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

	if (
		typeof value !== "string" ||
		!isoDateTimePattern.test(value) ||
		Number.isNaN(Date.parse(value))
	) {
		throw new Error(`${name} must be an ISO date string or null`);
	}

	return value;
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

	const settings = body as unknown as SiteSettings;
	let rows: SettingRow[];
	let parsedSettings: SiteSettings;

	try {
		rows = await serializeSettingsForStorage(
			settings,
			env.CONFIG_ENCRYPTION_KEY,
		);
	} catch (error) {
		if (isSettingsValidationError(error)) {
			return errorJson("BAD_REQUEST", "Invalid settings", 400);
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
			return errorJson("BAD_REQUEST", "Invalid settings", 400);
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

	if (url.pathname === "/api/admin/sync" && request.method === "POST") {
		return handleManualSync(request, env, options);
	}

	return adminNotFound();
}
