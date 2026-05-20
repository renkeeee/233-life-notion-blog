import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes("node_modules")) {
						return;
					}

					if (
						/(react-markdown|remark-|rehype-|unified|micromark|mdast-|hast-|vfile|unist-)/.test(
							id,
						)
					) {
						return "markdown";
					}

					if (
						/(react-datepicker|date-fns|@floating-ui|tabbable)/.test(id)
					) {
						return "admin-vendor";
					}
				},
			},
		},
	},
	plugins: [react(), tailwindcss(), cloudflare(), tsconfigPaths()],
});
