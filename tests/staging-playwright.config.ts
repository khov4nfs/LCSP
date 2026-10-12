import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./staging-playwright",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30 * 60 * 1000,
  reporter: "list",
});
