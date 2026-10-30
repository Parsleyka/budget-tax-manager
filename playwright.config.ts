import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the PRODUCTION build (`pnpm build` first — `pnpm e2e` does it).
 *
 * Data: the server gets BUDGET_DATA_DIR=./.e2e-data (git-ignored), which `e2e/global-setup.ts` wipes
 * before any test runs — never the real ./data. Playwright starts the web server BEFORE global setup,
 * so the readiness probe hits a static file (no data access) and the first page request seeds the
 * freshly wiped directory.
 */
const PORT = Number(process.env.E2E_PORT ?? 3910);
export const E2E_DATA_DIR = path.join(__dirname, ".e2e-data");

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One server, one data dir: run the specs one after another.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "en-GB",
    timezoneId: "Europe/Kyiv",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start -p ${PORT}`,
    url: `http://localhost:${PORT}/favicon.ico`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { BUDGET_DATA_DIR: E2E_DATA_DIR },
  },
});
