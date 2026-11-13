/** Test profiles share build steps within one invocation; standalone commands remain available. */
import { spawnSync } from "node:child_process";
import { globSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
const playwright = require.resolve("@playwright/test/cli");
const profile = process.argv[2] || "core";
const desktopPreparation = ["buildCore", "jsxTypes", "desktopBuild"];
const platformTests = ["python", "components", "node", "desktopTests", "runtime", "ui"];
const profiles = {
  quick: ["buildCore", "components", "quick"],
  node: ["buildCore", "components", "node"],
  runtime: ["buildCore", "desktopTests", "runtime"],
  ui: ["rootTypes", "jsxTypes", "desktopBuild", "ui"],
  core: ["buildCore", "desktopTypes", "jsxTypes", "checks", "python", "components", "node"],
  desktop: ["buildCore", "jsxTypes", "desktopBuild", "desktopTests", "runtime", "ui"],
  platform: [...desktopPreparation, ...platformTests],
  all: [...desktopPreparation, "checks", ...platformTests],
};
if (!Object.hasOwn(profiles, profile)) throw new Error(`Unknown test profile: ${profile}`);

function run(command, args, shell = false) {
  const start = performance.now();
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", shell });
  if (result.error) throw result.error;
  console.log(`${command} ${args.join(" ")}: ${((performance.now() - start) / 1000).toFixed(1)}s`);
  if (result.status !== 0 || result.signal) process.exit(result.status || 1);
}
const node = (...args) => run(process.execPath, args);
const npm = (...args) => run("npm", args, process.platform === "win32");
function suite(patterns) {
  const files = patterns.flatMap((pattern) => {
    const matches = [...globSync(pattern, { cwd: root })];
    if (!matches.length) throw new Error(`没有找到测试：${pattern}`);
    return matches;
  });
  node("--test", "--import", "./test/setup.mjs", ...files.sort());
}
const stages = {
  buildCore: () => {
    // A moved source must not keep working through a stale emitted module.
    rmSync(new URL("../build/", import.meta.url), { recursive: true, force: true });
    npm("run", "build");
  },
  // buildCore checks the root tsconfig while emitting files; desktopBuild checks desktop types.
  rootTypes: () => node(tsc, "-p", "tsconfig.json", "--noEmit"),
  desktopTypes: () => node(tsc, "-p", "apps/desktop/tsconfig.json", "--noEmit"),
  jsxTypes: () => node(tsc, "-p", "tsconfig.jsx.json", "--noEmit"),
  checks() {
    for (const name of ["lint", "guard", "format:check", "audit:exports"]) npm("run", name);
  },
  python: () => npm("run", "test:py"),
  components: () => node("scripts/build-test-components.mjs"),
  desktopTests: () => node("scripts/build-desktop-test.mjs"),
  desktopBuild: () => npm("run", "build", "-w", "@writer/desktop"),
  quick: () =>
    suite([
      "test/flow.test.mjs",
      "test/engine/quick-workflow.test.mjs",
      "test/engine/lock-cleanup-race.test.mjs",
      "test/workflow-core.test.mjs",
      "test/renderer/shell.test.mjs",
    ]),
  node: () => suite(["test/*.test.mjs", "test/engine/*.test.mjs", "test/renderer/*.test.mjs"]),
  runtime: () => suite(["test/desktop/*.test.mjs"]),
  ui: () => node(playwright, "test", "--config", "apps/desktop/playwright.config.mjs"),
};
for (const stage of profiles[profile]) stages[stage]();
