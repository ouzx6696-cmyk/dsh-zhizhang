import path from "node:path";
import { existsSync } from "node:fs";
import { rm, mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { copyRuntimeAssets } from "./runtime-assets.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = path.join(root, "apps", "desktop", "resources", "zhizhang");
await rm(out, { recursive: true, force: true });
await copyRuntimeAssets(out);
await mkdir(path.join(out, "licenses"), { recursive: true });

function resolveFontLicense(family) {
  const candidates = [
    path.join(root, "node_modules", "@fontsource", family, "LICENSE"),
    path.join(root, "apps", "desktop", "node_modules", "@fontsource", family, "LICENSE"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`未找到字体许可文件: @fontsource/${family}/LICENSE`);
  }
  return found;
}

for (const family of ["noto-serif-sc"]) {
  await cp(resolveFontLicense(family), path.join(out, "licenses", `${family}-LICENSE`));
}
console.log("桌面写作资源已准备");
