import { describe, expect, it } from "vitest";
import { parseCookies, serializeCookie } from "../workers/cookies";

describe("cookie helpers", () => {
	it("parses cookies from a request header", () => {
		expect(parseCookies("admin_session=abc; csrf=xyz")).toEqual({
			admin_session: "abc",
			csrf: "xyz",
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
});
