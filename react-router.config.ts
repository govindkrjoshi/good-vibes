import { cp, rm } from "node:fs/promises";
import path from "node:path";
import type { Config } from "@react-router/dev/config";

const basename = process.env.BASE_PATH ?? "/";

// GitHub Pages serves the app from /good-vibes/ and can only host static
// files, so the app is prerendered and its base path comes from the build.
export default {
  ssr: false,
  basename,
  prerender: ["/", "/sandbox.html"],
  // Prerendered pages land under build/client/<basename>/, but the host
  // serves build/client itself at the base path, so they move up to it.
  async buildEnd({ reactRouterConfig }) {
    if (basename === "/") return;
    const client = path.join(reactRouterConfig.buildDirectory, "client");
    const nested = path.join(client, basename);
    await cp(nested, client, { recursive: true });
    await rm(nested, { recursive: true });
  },
} satisfies Config;
