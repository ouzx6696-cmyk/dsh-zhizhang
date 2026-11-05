import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { OpenWorkContext, PluginConfig, StoragePaths } from "../types.js";

import { NovelError } from "../errors.js";

import { assertSafeAncestors, WINDOWS_RESERVED_NAME } from "./primitives.js";

export function slugify(title: string) {
  const cleaned = Array.from(
    title
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, ""),
  )
    .slice(0, 60)
    .join("");
  if (cleaned.length === 0) return `work-${Date.now().toString(36)}`;
  return WINDOWS_RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
}

function resolveRoot(raw: string | undefined, cwd: string, fallback: string): string {
  return raw ? path.resolve(cwd, raw) : fallback;
}
export function storagePaths(
  exec: OpenWorkContext | null,
  config: PluginConfig,
  workingDir?: string,
): StoragePaths {
  const cwd = exec === null ? process.cwd() : exec.cwd;
  const configuredRoot = config.storageRoot || process.env.WRITER_NOVEL_ROOT;
  const base = resolveRoot(
    workingDir,
    cwd,
    resolveRoot(configuredRoot, process.cwd(), path.resolve(cwd, config.rootDir ?? ".writer")),
  );
  return {
    base,
    works: resolveRoot(
      (config.worksRoot ?? process.env.WRITER_NOVEL_WORKS)?.trim(),
      cwd,
      path.join(base, "works"),
    ),
    manuscripts: path.join(base, "manuscripts"),
    library: resolveRoot(
      (config.libraryRoot ?? process.env.WRITER_NOVEL_LIBRARY)?.trim(),
      cwd,
      path.join(base, "library"),
    ),
    inspiration: path.join(base, "inspiration"),
    sourceRoot: resolveRoot(
      (config.sourceRoot ?? process.env.WRITER_NOVEL_SOURCE_ROOT)?.trim(),
      cwd,
      "",
    ),
  };
}
export async function ensureStorage(
  exec: OpenWorkContext | null,
  config: PluginConfig,
  workingDir?: string,
): Promise<StoragePaths> {
  const paths = storagePaths(exec, config, workingDir);
  await Promise.all(
    [paths.works, paths.manuscripts, paths.library, paths.inspiration].map((root) =>
      assertSafeAncestors(path.join(root, ".root-check")),
    ),
  );
  await mkdir(paths.works, { recursive: true });
  await mkdir(paths.manuscripts, { recursive: true });
  await mkdir(paths.library, { recursive: true });
  await mkdir(paths.inspiration, { recursive: true });
  // Tools pass exec; HTTP passes null. Remembering only tool roots lets the
  // Web panel follow the workspace the Agent is actually writing to.
  if (exec) {
    await rememberToolBase(paths.base, paths.works);
    await rememberProject(paths.base, paths.works);
  }
  return paths;
}
export function workDir(paths: StoragePaths, key: string) {
  const safe = slugify(key);
  if (safe.includes("..") || path.isAbsolute(safe)) {
    throw new NovelError("bad_id", "作品 key 非法");
  }
  return resolveInside(paths.works, safe);
}
export function ledgerPath(dir: string) {
  return path.join(dir, "ledger.json");
}
export function candidatesDir(dir: string) {
  return path.join(dir, "candidates");
}
import { rememberProject, rememberToolBase } from "./projects.js";
import { resolveInside } from "../../../../core/src/fsx.js";
