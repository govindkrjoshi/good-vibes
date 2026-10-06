import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Playwright specs in e2e/ match Vitest's default *.spec.ts glob.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
