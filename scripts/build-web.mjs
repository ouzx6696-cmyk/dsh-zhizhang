import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopNodeModules = path.join(repoRoot, "apps/desktop/node_modules");

async function loadVite() {
  const localVite = path.join(desktopNodeModules, "vite/dist/node/index.js");
  if (existsSync(localVite)) return import(pathToFileURL(localVite).href);
  return import("vite");
}

execFileSync(process.execPath, [path.join(repoRoot, "node_modules/typescript/bin/tsc"), "-b"], {
  cwd: repoRoot,
  stdio: "inherit",
});

const { build: viteBuild } = await loadVite();
await viteBuild({
  configFile: path.join(repoRoot, "apps/desktop/vite.web.config.ts"),
});

await esbuild({
  entryPoints: [path.join(repoRoot, "apps/desktop/src/server/web-server.ts")],
  outfile: path.join(repoRoot, "apps/desktop/out/server/web-server.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  nodePaths: [desktopNodeModules],
  external: ["electron", "@earendil-works/*", "docx", "undici", "typebox", "vite"],
});

console.log("织章 Web 预览与工作区构建完成");
