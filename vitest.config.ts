import { configDefaults, defineConfig } from "vitest/config";
import { sandboxRuntime } from "./app/sandbox/vite-plugin.ts";

export default defineConfig({
  plugins: [sandboxRuntime()],
  define: { __DEV_AGENT_CREDENTIAL__: "null" },
  test: {
    environment: "node",
    // Playwright specs in e2e/ match Vitest's default *.spec.ts glob.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
