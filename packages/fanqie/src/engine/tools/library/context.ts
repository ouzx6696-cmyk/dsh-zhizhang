import { LibraryPort } from "../../ports/index.js";

import { storagePaths } from "../../storage/paths.js";

import { asString, config } from "../context.js";

import type { ExecContext } from "../types.js";
export async function openLibrary(
  exec: ExecContext,
  args: Record<string, unknown>,
  write: boolean,
) {
  const paths = storagePaths(exec, config, asString(args, "working_dir"));
  if (write) await LibraryPort.ensureLibrary(paths);
  return paths;
}
