import type { Config } from "@react-router/dev/config";

// React Router SPA mode imports the Cloudflare worker bundle during build.
(
	globalThis as typeof globalThis & {
		Cloudflare?: { compatibilityFlags: Record<string, boolean> };
	}
).Cloudflare ??= { compatibilityFlags: {} };

export default {
	ssr: false,
	future: {
		unstable_viteEnvironmentApi: true,
	},
} satisfies Config;
