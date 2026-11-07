/** Existing runners, grouped by workflow; each preparation runs once per invocation. */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("../", import.meta.url));
const profile = process.argv[2] || "core";
const profiles = {
  core: ["checks", "python", "node"],
  desktop: ["build", "runtime", "ui"],
  all: ["checks", "python", "node", "build", "runtime", "ui"],
};
if (!Object.hasOwn(profiles, profile)) throw new Error(`Unknown test profile: ${profile}`);
function run(command, args) {
  const start = performance.now();
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  console.log(`${command} ${args.join(" ")}: ${((performance.now() - start) / 1000).toFixed(1)}s`);
  if (result.status !== 0 || result.signal) process.exit(result.status || 1);
}
const npm = (name) => run("npm", ["run", name]);
const stages = {
  checks() {
    for (const name of ["typecheck", "lint", "guard", "format:check", "audit:exports"]) npm(name);
  },
  python() {
    npm("test:py");
  },
  node() {
    npm("test:node");
  },
  build() {
    if (profile === "desktop") npm("typecheck");
    run("npm", ["run", "build", "-w", "@writer/desktop"]);
  },
  runtime() {
    npm("test:desktop");
  },
  ui() {
    npm("test:desktop:ui");
  },
};
for (const stage of profiles[profile]) stages[stage]();
