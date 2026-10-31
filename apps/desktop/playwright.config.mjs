import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../../test/desktop",
  testMatch: "ui.spec.mjs",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  reporter: "list",
  outputDir: "../../test-results/electron",
  use: { trace: "retain-on-failure" },
  retries: 0,
});
