import { SettingsRepository } from "./db/d1";
import { sha256Hex } from "./crypto";

export const commentsDefaultEnabledKey = "commentsDefaultEnabled";
export const commentsGlobalEnabledKey = "commentsGlobalEnabled";
export const commentsModerationEnabledKey = "commentsModerationEnabled";
export const commentRateLimitMessage =
	"Too many comments. Please wait before posting again.";

type CommentRateLimitInput = {
	body: string;
	nickname: string;
	postId: string;
	request: Request;
	rootKey: string;
	now?: Date;
};

type CommentRateLimitDecision =
	| { allowed: true }
	| { allowed: false; retryAfterSeconds: number };

type RateLimitRule = {
	key: string;
	limit: number;
	windowSeconds: number;
};

const rateLimitSchemaReady = new WeakSet<object>();

export async function loadCommentsDefaultEnabled(
	db: D1Database,
): Promise<boolean> {
	const row = await new SettingsRepository(db).get(commentsDefaultEnabledKey);

	return row?.value === "false" ? false : true;
}

export async function saveCommentsDefaultEnabled(
	db: D1Database,
	enabled: boolean,
	now = new Date().toISOString(),
): Promise<void> {
	await new SettingsRepository(db).put({
		key: commentsDefaultEnabledKey,
		value: enabled ? "true" : "false",
		encrypted: 0,
		updated_at: now,
	});
}

export async function loadCommentsGlobalEnabled(
	db: D1Database,
): Promise<boolean> {
	const row = await new SettingsRepository(db).get(commentsGlobalEnabledKey);

	return row?.value === "false" ? false : true;
}

export async function saveCommentsGlobalEnabled(
	db: D1Database,
	enabled: boolean,
	now = new Date().toISOString(),
): Promise<void> {
	await new SettingsRepository(db).put({
		key: commentsGlobalEnabledKey,
		value: enabled ? "true" : "false",
		encrypted: 0,
		updated_at: now,
	});
}

export async function loadCommentsModerationEnabled(
	db: D1Database,
): Promise<boolean> {
	const row = await new SettingsRepository(db).get(commentsModerationEnabledKey);

	return row?.value === "true";
}

export async function saveCommentsModerationEnabled(
	db: D1Database,
	enabled: boolean,
	now = new Date().toISOString(),
): Promise<void> {
	await new SettingsRepository(db).put({
		key: commentsModerationEnabledKey,
		value: enabled ? "true" : "false",
		encrypted: 0,
		updated_at: now,
	});
}

async function ensureCommentRateLimitSchema(db: D1Database): Promise<void> {
	const key = db as object;
	if (rateLimitSchemaReady.has(key)) {
		return;
	}

	await db
		.prepare(
			`CREATE TABLE IF NOT EXISTS comment_rate_limits (
				key TEXT PRIMARY KEY,
				count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
				reset_at TEXT NOT NULL,
				updated_at TEXT NOT NULL
			)`,
		)
		.run();
	await db
		.prepare(
			`CREATE INDEX IF NOT EXISTS idx_comment_rate_limits_reset_at
			 ON comment_rate_limits (reset_at)`,
		)
		.run();

	rateLimitSchemaReady.add(key);
}

function clientIpFromRequest(request: Request): string {
	return (
		request.headers.get("cf-connecting-ip") ??
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
		"unknown"
	);
}

function normalizedCommentFingerprintValue(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function consumeRateLimit(
	db: D1Database,
	rule: RateLimitRule,
	now: Date,
): Promise<CommentRateLimitDecision> {
	const nowIso = now.toISOString();
	const resetAt = new Date(now.getTime() + rule.windowSeconds * 1000);
	const resetAtIso = resetAt.toISOString();
	const row = await db
		.prepare(
			`INSERT INTO comment_rate_limits (key, count, reset_at, updated_at)
			 VALUES (?, 1, ?, ?)
			 ON CONFLICT(key) DO UPDATE SET
				count = CASE
					WHEN comment_rate_limits.reset_at <= ? THEN 1
					ELSE comment_rate_limits.count + 1
				END,
				reset_at = CASE
					WHEN comment_rate_limits.reset_at <= ? THEN excluded.reset_at
					ELSE comment_rate_limits.reset_at
				END,
				updated_at = excluded.updated_at
			 RETURNING count, reset_at`,
		)
		.bind(rule.key, resetAtIso, nowIso, nowIso, nowIso)
		.first<{ count: number; reset_at: string }>();
	const count = Number(row?.count ?? 1);

	if (count <= rule.limit) {
		return { allowed: true };
	}

	const retryAt = Date.parse(row?.reset_at ?? resetAtIso);
	const retryAfterSeconds = Number.isFinite(retryAt)
		? Math.max(1, Math.ceil((retryAt - now.getTime()) / 1000))
		: rule.windowSeconds;

	return { allowed: false, retryAfterSeconds };
}

export async function checkCommentSubmissionRateLimit(
	db: D1Database,
	input: CommentRateLimitInput,
): Promise<CommentRateLimitDecision> {
	await ensureCommentRateLimitSchema(db);

	const now = input.now ?? new Date();
	const nowIso = now.toISOString();
	await db
		.prepare("DELETE FROM comment_rate_limits WHERE reset_at <= ?")
		.bind(nowIso)
		.run();

	const ipHash = await sha256Hex(
		`comment-ip:${input.rootKey}:${clientIpFromRequest(input.request)}`,
	);
	const duplicateHash = await sha256Hex(
		[
			normalizedCommentFingerprintValue(input.nickname),
			normalizedCommentFingerprintValue(input.body),
		].join("\n"),
	);
	const clientKey = ipHash.slice(0, 40);
	const duplicateKey = duplicateHash.slice(0, 40);
	const rules: RateLimitRule[] = [
		{
			key: `comment:ip:${clientKey}:60`,
			limit: 3,
			windowSeconds: 60,
		},
		{
			key: `comment:post:${input.postId}:ip:${clientKey}:600`,
			limit: 5,
			windowSeconds: 600,
		},
		{
			key: `comment:ip:${clientKey}:3600`,
			limit: 20,
			windowSeconds: 3600,
		},
		{
			key: `comment:dup:${input.postId}:${clientKey}:${duplicateKey}:600`,
			limit: 1,
			windowSeconds: 600,
		},
	];

	for (const rule of rules) {
		const result = await consumeRateLimit(db, rule, now);
		if (!result.allowed) {
			return result;
		}
	}

	return { allowed: true };
}
