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

if (!existsSync(path.join(repoRoot, "packages/core/dist/index.js"))) {
  execFileSync(process.execPath, [path.join(repoRoot, "node_modules/typescript/bin/tsc"), "-b"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}

const serverBundle = path.join(repoRoot, "apps/desktop/out/server/web-server.mjs");
await esbuild({
  entryPoints: [path.join(repoRoot, "apps/desktop/src/server/web-server.ts")],
  outfile: serverBundle,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  nodePaths: [desktopNodeModules],
  external: ["electron", "@earendil-works/*", "docx", "undici", "typebox", "vite"],
});

const { createServer: createViteServer } = await loadVite();
const vite = await createViteServer({
  configFile: path.join(repoRoot, "apps/desktop/vite.web.config.ts"),
  server: { middlewareMode: true, hmr: false },
  appType: "spa",
});

const { startWebPreviewServer } = await import(pathToFileURL(serverBundle).href);
const preview = await startWebPreviewServer({
  repoRoot,
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
  middleware: (req, res, next) => vite.middlewares(req, res, next),
});

console.log(`织章工作台开发服务器运行于 http://${preview.host}:${preview.port}`);

const shutdown = async () => {
  await preview.close();
  await vite.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
