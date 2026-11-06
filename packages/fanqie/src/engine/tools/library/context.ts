import { isMissingFileError } from "../../../../../core/src/fsx.js";
import { normalizeUserPath } from "../../ports/library/store.js";
import path from "node:path";

import { stat } from "node:fs/promises";
import { LibraryPort } from "../../ports/index.js";

import { storagePaths } from "../../storage/paths.js";

import { asString, config } from "../context.js";

import type { ExecContext } from "../types.js";
import type { StoragePaths } from "../../types.js";
export async function openLibrary(
  exec: ExecContext,
  args: Record<string, unknown>,
  write: boolean,
) {
  const paths = storagePaths(exec, config, asString(args, "working_dir"));
  if (write) await LibraryPort.ensureLibrary(paths);
  return paths;
}
export async function resolveBookFile(
  paths: StoragePaths,
  exec: ExecContext,
  raw: string | undefined,
) {
  if (!raw) return raw;
  raw = normalizeUserPath(raw);
  if (path.isAbsolute(raw)) return raw;
  const cwd = exec.cwd;
  const candidates = [path.resolve(cwd, raw)];
  if (paths.sourceRoot) candidates.push(path.resolve(paths.sourceRoot, raw));
  for (const cand of candidates) {
    try {
      if ((await stat(cand)).isFile()) return cand;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
  return raw;
}
