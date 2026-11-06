import path from "node:path";
import { rm, mkdir, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { copyRuntimeAssets } from "./runtime-assets.mjs";
const out = fileURLToPath(new URL("../apps/desktop/resources/writer/", import.meta.url));
await rm(out, { recursive: true, force: true });
await copyRuntimeAssets(out);
await mkdir(path.join(out, "licenses"), { recursive: true });
for (const family of ["noto-sans-sc", "noto-serif-sc"])
  await cp(
    new URL("../node_modules/@fontsource/" + family + "/LICENSE", import.meta.url),
    path.join(out, "licenses", family + "-LICENSE"),
  );
console.log("桌面写作资源已准备");
