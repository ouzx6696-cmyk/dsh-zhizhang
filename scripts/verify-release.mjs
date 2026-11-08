/** One candidate, one preparation per target. Standalone commands remain usable. */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const npm = (args, cwd = root) =>
  execFileSync("npm", args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
if (process.platform !== "win32")
  throw new Error("发行验证请在 Windows 执行，不能以 Linux 构建代替原生交付。");
npm(["run", "test:all"]);
execFileSync(process.execPath, ["scripts/prepare-desktop-python.mjs"], {
  cwd: root,
  stdio: "inherit",
});
execFileSync(
  "npx",
  ["--no-install", "electron-builder", "--win", "nsis", "zip", "--x64", "--publish", "never"],
  {
    cwd: fileURLToPath(new URL("../apps/desktop/", import.meta.url)),
    stdio: "inherit",
    shell: true,
  },
);
execFileSync(process.execPath, ["scripts/check-desktop-package.mjs"], {
  cwd: root,
  stdio: "inherit",
});
