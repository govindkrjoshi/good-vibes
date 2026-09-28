import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
  // Component tests import through the `~/*` alias the app uses.
  resolve: {
    tsconfigPaths: true,
  },
});
