import { configDefaults, defineConfig } from "vitest/config";
import { sandboxBundle } from "./sandbox-bundle.ts";

export default defineConfig({
  plugins: [sandboxBundle()],
  define: { __DEV_OPENROUTER_API_KEY__: JSON.stringify("") },
  test: {
    environment: "node",
    // Playwright specs in e2e/ match Vitest's default *.spec.ts glob.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
