import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:5173";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    // Locally there are no retries, so "on-first-retry" would never record
    // anything: a failure on a dev machine is exactly when the trace is wanted.
    trace: isCI ? "on-first-retry" : "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Run the dev server binary directly rather than through `pnpm --filter`:
    // pnpm detaches the script into its own process group, which leaves the
    // server orphaned when Playwright tears down and hangs the run.
    command: "./node_modules/.bin/react-router dev",
    cwd: "../frontend",
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 60_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 2_000 },
  },
});
