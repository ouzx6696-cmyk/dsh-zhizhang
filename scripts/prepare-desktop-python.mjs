import { mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const dir = fileURLToPath(new URL("../apps/desktop/resources/", import.meta.url));
const hash = "ebe90cc1dce2dd2d7afa1f0aa9b6c269c7c0174aeabdc6a801381602b7283424";
const url =
  "https://github.com/astral-sh/python-build-standalone/releases/download/20261026/cpython-3.13.18%2B20261026-x86_64-pc-windows-msvc-install_only.tar.gz";
await mkdir(dir, { recursive: true });
const archive = path.join(dir, "python.tar.gz");
async function trimRuntime() {
  const root = path.join(dir, "python");
  for (const name of ["include", "libs", "Scripts", "Lib/test", "Lib/site-packages"])
    await rm(path.join(root, name), { recursive: true, force: true });
  for (const folder of [root, path.join(root, "DLLs")])
    for (const item of await readdir(folder))
      if (item.endsWith(".pdb")) await rm(path.join(folder, item));
}
const existing = await readFile(path.join(dir, "python", "writer-runtime.json"), "utf8").catch(
  () => "",
);
if (existing && JSON.parse(existing).sha256 === hash) {
  await trimRuntime();
  console.log("随包 Python 已准备");
  process.exit(0);
}
const archiveHash = await readFile(archive)
  .then((value) => createHash("sha256").update(value).digest("hex"))
  .catch(() => "");
if (archiveHash !== hash) {
  await rm(archive, { force: true });
  execFileSync("curl", ["--fail", "--location", "--output", archive, url], {
    stdio: "inherit",
  });
  const digest = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  if (digest !== hash) throw new Error("Python 运行包校验值不符");
}
await rm(path.join(dir, "python"), { recursive: true, force: true });
execFileSync("tar", ["-xzf", "python.tar.gz", "-C", "."], {
  cwd: dir,
  stdio: "inherit",
});
await writeFile(
  path.join(dir, "python", "writer-runtime.json"),
  JSON.stringify({ version: "3.13.18", target: "windows-x64", url, sha256: hash }, null, 2),
);
await trimRuntime();
await rm(archive);
