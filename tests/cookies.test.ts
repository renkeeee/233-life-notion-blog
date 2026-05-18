import { describe, expect, it } from "vitest";
import { parseCookies, serializeCookie } from "../workers/cookies";

describe("cookie helpers", () => {
	it("parses cookies from a request header", () => {
		expect(parseCookies("admin_session=abc; csrf=xyz")).toEqual({
			admin_session: "abc",
			csrf: "xyz",
		});
	});

	it("ignores malformed header fragments with empty cookie names", () => {
		expect(parseCookies("=bad; ; admin_session=abc; =also-bad")).toEqual({
			admin_session: "abc",
		});
	});

	it("serializes secure HttpOnly cookies", () => {
		const cookie = serializeCookie("admin_session", "abc", {
			httpOnly: true,
			maxAge: 60,
			path: "/",
			sameSite: "Lax",
			secure: true,
		});
		expect(cookie).toContain("admin_session=abc");
		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("Max-Age=60");
		expect(cookie).toContain("SameSite=Lax");
		expect(cookie).toContain("Secure");
	});

	it("serializes encoded cookie values", () => {
		const cookie = serializeCookie("admin_session", "a b=c%", {
			path: "/",
			secure: true,
		});

		expect(cookie).toContain("admin_session=a%20b%3Dc%25");
	});

	it("rejects invalid cookie names", () => {
		expect(() => serializeCookie("admin session", "abc")).toThrow(
			"Invalid cookie name",
		);
		expect(() => serializeCookie("admin=session", "abc")).toThrow(
			"Invalid cookie name",
		);
	});

	it("rejects unsafe cookie values", () => {
		expect(() => serializeCookie("admin_session", "abc; Secure")).toThrow(
			"Invalid cookie value",
		);
		expect(() => serializeCookie("admin_session", "abc\n")).toThrow(
			"Invalid cookie value",
		);
	});

	it("rejects invalid cookie paths", () => {
		expect(() =>
			serializeCookie("admin_session", "abc", { path: "/; Max-Age=1" }),
		).toThrow("Invalid cookie path");
		expect(() =>
			serializeCookie("admin_session", "abc", { path: "/admin\n" }),
		).toThrow("Invalid cookie path");
	});

	it("rejects invalid Max-Age values", () => {
		for (const maxAge of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => serializeCookie("admin_session", "abc", { maxAge })).toThrow(
				"Invalid cookie Max-Age",
			);
		}
	});

	it("requires Secure when SameSite is None", () => {
		expect(() =>
			serializeCookie("admin_session", "abc", { sameSite: "None" }),
		).toThrow("SameSite=None cookies must be Secure");
	});
});
