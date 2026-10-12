import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
    trace: "on-first-retry",
  },
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  webServer: [
    {
      command: "node tests/e2e/fixtures/billing-api-fixture.mjs",
      url: "http://127.0.0.1:3102/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30 * 1000,
    },
    {
      command: "node node_modules/next/dist/bin/next dev --port 3100",
      cwd: "apps/web",
      url: "http://127.0.0.1:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: { LCSP_API_BASE_URL: "http://127.0.0.1:3102" },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
          ? {
              launchOptions: {
                executablePath:
                  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
              },
            }
          : {}),
      },
    },
  ],
});
