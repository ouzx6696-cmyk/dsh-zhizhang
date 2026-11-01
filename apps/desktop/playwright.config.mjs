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
  // 基线用本机 Noto 字体渲染；CI 无该字体，只核对结构与布局，像素比对留在本地。
  ignoreSnapshots: !process.env.CI,
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.2 },
  },
  use: { trace: "retain-on-failure" },
  retries: 0,
});
