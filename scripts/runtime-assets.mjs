import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export async function copyRuntimeAssets(out) {
  for (const [mode, dest] of [
    ["toutiao", "skill"],
    ["fanqie", "skill-fanqie"],
  ]) {
    const source = path.join(root, "packages", mode, "skill");
    await cp(source, path.join(out, dest), {
      recursive: true,
      filter: (file) => {
        const parts = path.relative(source, file).split(path.sep);
        return !parts.includes("__pycache__") && parts[0] !== "tests";
      },
    });
    await cp(
      path.join(root, "packages", mode, "profiles/default"),
      path.join(out, "profiles", mode, "default"),
      { recursive: true },
    );
  }
  await mkdir(path.join(out, "assets"), { recursive: true });
  for (const name of ["manifest.json", "sources.json"])
    await cp(path.join(root, "assets", name), path.join(out, "assets", name));
  await mkdir(path.join(out, "scripts"), { recursive: true });
  await cp(
    path.join(root, "scripts/backup.mjs"),
    path.join(out, "scripts/writer-backup.mjs"),
  );
}
