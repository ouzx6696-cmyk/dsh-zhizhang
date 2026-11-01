import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "../../test/desktop",
  testMatch: "ui.spec.mjs",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  reporter: "list",
  outputDir: "../../test-results/electron",
  snapshotPathTemplate: "../../docs/design/baseline/{arg}{ext}",
  // 像素基线只在本机比对；CI 环境差异交给结构与布局断言。
  ignoreSnapshots: !!process.env.CI,
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.2 },
  },
  use: { trace: "retain-on-failure" },
  retries: 0,
});
