/**
 * 把桌面层 / 包内 TS 入口用 esbuild 打成一个 ESM 文件再导入（测试专用）。
 * @zhizhang/* 经 package.json exports 解析并打进包；electron、PI SDK 与第三方依赖保持外部，
 * 被测入口不得在加载时触达它们（桌面层只测不依赖 electron 的模块）。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "apps", "desktop", "node_modules", ".cache", "zhizhang-test");
const EXTERNAL = ["electron", "@earendil-works/*", "docx", "undici"];

export async function importBundle(relEntry) {
  const entry = path.resolve(ROOT, relEntry);
  const key = createHash("sha256").update(`${entry}:${process.pid}`).digest("hex").slice(0, 16);
  const outfile = path.join(OUT_DIR, `${path.basename(entry).replace(/\.tsx?$/, "")}-${key}.mjs`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    external: EXTERNAL,
    nodePaths: [path.join(ROOT, "apps", "desktop", "node_modules")],
    logLevel: "silent",
    sourcemap: false,
  });
  return import(pathToFileURL(outfile).href);
}
