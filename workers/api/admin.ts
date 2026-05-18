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
import type { AppEnv, SiteSettings } from "../types";

type LoginBody = {
	password: string;
};

const adminPasswordHashKey = "adminPasswordHash";
const adminSessionCookie = "admin_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 7;

export function validateLoginBody(body: Record<string, unknown>): LoginBody {
	if (typeof body.password !== "string" || body.password.length === 0) {
		throw new Error("Password is required");
	}

	return { password: body.password };
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

function sessionCookie(value: string, maxAge: number): string {
	return serializeCookie(adminSessionCookie, value, {
		httpOnly: true,
		maxAge,
		path: "/",
		sameSite: "Lax",
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

function requireCsrf(request: Request, session: AdminSession): Response | null {
	if (request.headers.get("x-csrf-token") !== session.csrfToken) {
		return invalidCsrf();
	}

	return null;
}

async function authenticatePassword(
	password: string,
	repository: SettingsRepository,
): Promise<boolean> {
	const storedHash = (await repository.get(adminPasswordHashKey))?.value ?? null;

	if (shouldBootstrapPassword(storedHash)) {
		if (password !== initialAdminPassword) {
			return false;
		}

		await repository.put({
			key: adminPasswordHashKey,
			value: await hashPassword(initialAdminPassword),
			encrypted: 0,
			updated_at: new Date().toISOString(),
		});
		return true;
	}

	if (storedHash === null) {
		return false;
	}

	return verifyPassword(password, storedHash);
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
			error instanceof Error && error.message === "Password is required"
				? error.message
				: "Invalid request body";
		return errorJson("BAD_REQUEST", message, 400);
	}

	const repository = new SettingsRepository(env.DB);
	const authenticated = await authenticatePassword(loginBody.password, repository);

	if (!authenticated) {
		return invalidCredentials();
	}

	const csrfToken = randomToken(24);
	const token = await createSessionToken(
		env.CONFIG_ENCRYPTION_KEY,
		csrfToken,
	);

	return json(
		{ authenticated: true, csrfToken },
		200,
		new Headers({
			"set-cookie": sessionCookie(token, sessionMaxAgeSeconds),
		}),
	);
}

async function handleMe(request: Request, env: AppEnv): Promise<Response> {
	const session = await currentSession(request, env.CONFIG_ENCRYPTION_KEY);

	if (!session) {
		return json({ authenticated: false });
	}

	return json({ authenticated: true, csrfToken: session.csrfToken });
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

function siteSettingRows(rows: SettingRow[]): SettingRow[] {
	return rows.filter((row) => row.key !== adminPasswordHashKey);
}

async function handleGetSettings(
	request: Request,
	env: AppEnv,
): Promise<Response> {
	const session = await requireSession(request, env.CONFIG_ENCRYPTION_KEY);

	if (session instanceof Response) {
		return session;
	}

	try {
		const repository = new SettingsRepository(env.DB);
		const settings = await parseSettingsFromRows(
			siteSettingRows(await repository.list()),
			env.CONFIG_ENCRYPTION_KEY,
		);

		return json(redactSettings(settings));
	} catch (error) {
		if (isMissingSettingsError(error)) {
			return errorJson("NOT_FOUND", "Settings not found", 404);
		}

		return errorJson("BAD_REQUEST", "Invalid settings", 400);
	}
}

async function handlePutSettings(
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

	let body: Record<string, unknown>;

	try {
		body = await readJsonObject(request);
	} catch {
		return errorJson("BAD_REQUEST", "Invalid request body", 400);
	}

	try {
		const settings = body as unknown as SiteSettings;
		const rows = await serializeSettingsForStorage(
			settings,
			env.CONFIG_ENCRYPTION_KEY,
		);
		const parsedSettings = await parseSettingsFromRows(
			rows,
			env.CONFIG_ENCRYPTION_KEY,
		);
		await new SettingsRepository(env.DB).putMany(rows);

		return json(redactSettings(parsedSettings));
	} catch {
		return errorJson("BAD_REQUEST", "Invalid settings", 400);
	}
}

export async function handleAdminApi(
	request: Request,
	env: AppEnv,
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

	if (url.pathname === "/api/admin/settings" && request.method === "GET") {
		return handleGetSettings(request, env);
	}

	if (url.pathname === "/api/admin/settings" && request.method === "PUT") {
		return handlePutSettings(request, env);
	}

	return adminNotFound();
}
