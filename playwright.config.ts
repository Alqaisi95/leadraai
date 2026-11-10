import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke suite. Runs against a real dev server + real database, so it needs
 * DATABASE_URL and the seeded demo org. Kept out of `npm test` (unit) on purpose.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // A cold Next 16 dev server has to compile each route on first hit, and the
  // credential endpoints hash with bcrypt on top of that. 45s was not enough
  // for the first test through a route.
  timeout: 90_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    locale: "ar-IQ",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/state.json" },
      dependencies: ["setup"],
      testMatch: /.*\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npx next dev -p 3100",
        // Own build directory — see the note in next.config.js.
        env: { NEXT_DIST_DIR: ".next-e2e" },
        url: "http://127.0.0.1:3100/login",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
