import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { copyRuntimeAssets } from "./runtime-assets.mjs";
const out = fileURLToPath(
  new URL("../apps/desktop/resources/writer/", import.meta.url),
);
await rm(out, { recursive: true, force: true });
await copyRuntimeAssets(out);
console.log("桌面写作资源已准备");
